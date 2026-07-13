"""
╔══════════════════════════════════════════════════════════════════╗
║         QuantumX Smart Segregator — Raspberry Pi Edition         ║
║                                                                  ║
║  HARDWARE:                                                       ║
║    Servo 1 (Router)  → GPIO 17  (PWM)                           ║
║    Servo 2 (Lid)     → GPIO 27  (PWM)                           ║
║    IR Sensor         → GPIO 22  (Digital IN)                    ║
║    Webcam            → USB (index 0)                            ║
║                                                                  ║
║  BIN ANGLES (Servo 1):                                           ║
║    Reject  →  15°                                                ║
║    Metal   →  45°                                                ║
║    Organic →  75°                                                ║
║    Plastic → 105°                                                ║
║    Paper   → 135°                                                ║
║    E-waste → 165°                                                ║
║                                                                  ║
║  FLOW:                                                           ║
║    IR detects object → Camera captures → YOLO classifies        ║
║    → Servo 1 rotates to bin → Servo 2 opens lid                 ║
║    → Waste falls onto chute → Servo 1 guides to bin             ║
║    → Wait for IR to clear → Both servos recalibrate to 0°       ║
╚══════════════════════════════════════════════════════════════════╝

RUN:
    python app.py

INSTALL DEPS:
    pip install flask ultralytics opencv-python RPi.GPIO
"""

from flask import Flask, jsonify, render_template, Response
import threading
import time
import os
import sys
from collections import Counter
from datetime import datetime

# ── GPIO / Hardware import (graceful fallback for dev on PC) ──
ON_RPI = os.path.exists('/sys/bus/platform/drivers/raspberrypi-firmware')
try:
    import RPi.GPIO as GPIO
    ON_RPI = True
    print("[HW] Raspberry Pi GPIO available ✓")
except ImportError:
    ON_RPI = False
    print("[HW] RPi.GPIO not found — running in SIMULATION mode")

# ── OpenCV ──
import cv2

# ── YOLO ──
try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    YOLO_AVAILABLE = False
    print("[MODEL] ultralytics not installed — demo mode")

import random

app = Flask(__name__)

# ════════════════════════════════════════════════════════════════
# HARDWARE CONFIG
# ════════════════════════════════════════════════════════════════

# GPIO Pin Numbers (BCM mode)
PIN_SERVO_ROUTER = 17   # Servo 1 — routes waste to correct bin
PIN_SERVO_LID    = 27   # Servo 2 — opens/closes bin lid
PIN_IR_SENSOR    = 22   # IR sensor — detects object in chute

# SG90 PWM config
PWM_FREQ = 50           # 50 Hz standard for SG90

# Servo 1 — Bin Router angles (degrees)
BIN_ANGLES = {
    "reject":        15,
    "metal waste":   45,
    "organic waste": 75,
    "plastic waste": 105,
    "paper waste":   135,
    "E-waste":       165,
}

# Servo 2 — Lid angles
LID_CLOSED_ANGLE = 0
LID_OPEN_ANGLE   = 90

# Home/neutral position for both servos after recalibration
SERVO_HOME_ANGLE = 0

# Timing config (seconds)
WAIT_AFTER_ROUTE  = 1.0   # time for waste to slide after routing
WAIT_LID_OPEN     = 2.5   # how long lid stays open
WAIT_RECALIBRATE  = 0.8   # pause before recalibrating

# Detection config
CONF_THRESHOLD = 0.75
NUM_FRAMES     = 5
FRAME_DELAY    = 0.2

# IR debounce
IR_DEBOUNCE_MS = 50

# Model paths to try
MODEL_PATHS = [
    "runs/classify/quantumx_model/weights/best.pt",
    "runs/classify/train/weights/best.pt",
    "best.pt",
    "model/best.pt",
    "weights/best.pt",
]

# ════════════════════════════════════════════════════════════════
# GPIO SETUP
# ════════════════════════════════════════════════════════════════

pwm_router = None
pwm_lid    = None

def angle_to_duty(angle):
    """
    Convert servo angle (0–180°) to PWM duty cycle for SG90.
    SG90: 0° = 2.5%, 90° = 7.5%, 180° = 12.5%
    Formula: duty = 2.5 + (angle / 180) * 10
    """
    return max(2.5, min(12.5, 2.5 + (angle / 180.0) * 10.0))

def setup_gpio():
    global pwm_router, pwm_lid
    if not ON_RPI:
        return

    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)

    # Servo pins as OUTPUT
    GPIO.setup(PIN_SERVO_ROUTER, GPIO.OUT)
    GPIO.setup(PIN_SERVO_LID,    GPIO.OUT)

    # IR sensor as INPUT with pull-up
    # IR module: LOW = object detected, HIGH = no object
    GPIO.setup(PIN_IR_SENSOR, GPIO.IN, pull_up_down=GPIO.PUD_UP)

    # Init PWM
    pwm_router = GPIO.PWM(PIN_SERVO_ROUTER, PWM_FREQ)
    pwm_lid    = GPIO.PWM(PIN_SERVO_LID,    PWM_FREQ)

    # Start at home position
    pwm_router.start(angle_to_duty(SERVO_HOME_ANGLE))
    pwm_lid.start(angle_to_duty(LID_CLOSED_ANGLE))
    time.sleep(0.5)

    # Attach IR interrupt
    GPIO.add_event_detect(
        PIN_IR_SENSOR,
        GPIO.FALLING,          # FALLING = object enters beam (LOW)
        callback=ir_triggered,
        bouncetime=IR_DEBOUNCE_MS
    )
    print("[GPIO] Setup complete ✓")

def move_servo(pwm, angle, label="servo"):
    """Smoothly move a servo to target angle."""
    if not ON_RPI or pwm is None:
        print(f"  [SIM] {label} → {angle}°")
        return
    duty = angle_to_duty(angle)
    pwm.ChangeDutyCycle(duty)
    time.sleep(0.4)   # wait for physical movement

def stop_servo(pwm):
    """Stop sending PWM pulses (reduces servo jitter)."""
    if ON_RPI and pwm:
        pwm.ChangeDutyCycle(0)

def cleanup_gpio():
    global pwm_router, pwm_lid
    if ON_RPI:
        if pwm_router: pwm_router.stop()
        if pwm_lid:    pwm_lid.stop()
        GPIO.cleanup()
        print("[GPIO] Cleaned up ✓")

# ════════════════════════════════════════════════════════════════
# CAMERA
# ════════════════════════════════════════════════════════════════

camera = None
cam_lock = threading.Lock()

def init_camera():
    global camera
    for idx in [0, 1]:
        cap = cv2.VideoCapture(idx)
        if cap.isOpened():
            ret, _ = cap.read()
            if ret:
                cap.set(cv2.CAP_PROP_FRAME_WIDTH,  640)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                cap.set(cv2.CAP_PROP_FPS, 30)
                camera = cap
                print(f"[CAM] Camera opened at index {idx} ✓")
                return
            cap.release()
    print("[CAM] No camera found — placeholder mode")

def generate_frames():
    """MJPEG stream generator."""
    while True:
        if camera is None or not camera.isOpened():
            # Black placeholder frame
            import numpy as np
            frame = np.zeros((480, 640, 3), dtype='uint8')
            cv2.putText(frame, "NO CAMERA", (200, 220),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 255, 225), 2)
            cv2.putText(frame, "Connect USB webcam", (185, 270),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (80, 80, 80), 1)
            _, buf = cv2.imencode('.jpg', frame)
            yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n'
                   + buf.tobytes() + b'\r\n')
            time.sleep(0.1)
            continue

        with cam_lock:
            ok, frame = camera.read()
        if not ok:
            time.sleep(0.05)
            continue

        _, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n'
               + buf.tobytes() + b'\r\n')

# ════════════════════════════════════════════════════════════════
# MODEL
# ════════════════════════════════════════════════════════════════

model = None
model_path_used = None

VALID_CLASSES = set(BIN_ANGLES.keys())
DEMO_CLASSES  = list(VALID_CLASSES)

def load_model():
    global model, model_path_used
    if not YOLO_AVAILABLE:
        print("[MODEL] Running in demo mode")
        return

    for path in MODEL_PATHS:
        if os.path.exists(path):
            try:
                model = YOLO(path)
                model_path_used = path
                print(f"[MODEL] Loaded: {path} ✓")
                print(f"[MODEL] Classes: {list(model.names.values())}")
                return
            except Exception as e:
                print(f"[MODEL] Failed {path}: {e}")

    print("[MODEL] No .pt file found — demo mode")

def normalize_class(raw):
    raw_l = raw.strip().lower()
    kw_map = {
        'plastic':    'plastic waste',
        'paper':      'paper waste',
        'metal':      'metal waste',
        'organic':    'organic waste',
        'e-waste':    'E-waste',
        'ewaste':     'E-waste',
        'electronic': 'E-waste',
        'reject':     'reject',
    }
    for cls in VALID_CLASSES:
        if raw_l == cls.lower():
            return cls
    for kw, mapped in kw_map.items():
        if kw in raw_l:
            return mapped
    return 'reject'

def demo_predict():
    cls  = random.choice(DEMO_CLASSES)
    conf = random.uniform(0.78, 0.99) if cls != 'reject' else random.uniform(0.40, 0.70)
    return cls, conf

# ════════════════════════════════════════════════════════════════
# GLOBAL STATE
# ════════════════════════════════════════════════════════════════

state = {
    "last_class":    "Waiting...",
    "confidence":    0.0,
    "busy":          False,
    "ir_triggered":  False,
    "servo1_angle":  SERVO_HOME_ANGLE,
    "servo2_status": "CLOSED",
    "conveyor":      "IDLE",
    "step":          "IDLE",       # current operation step for UI
    "log":           [],           # last 30 log entries
}

stats = {
    "plastic waste": 0, "paper waste":  0, "metal waste":  0,
    "organic waste": 0, "E-waste":      0, "reject":       0,
}

log_lock = threading.Lock()

def add_log(msg, level="info"):
    t = datetime.now().strftime("%H:%M:%S")
    entry = {"t": t, "msg": msg, "level": level}
    with log_lock:
        state["log"].append(entry)
        if len(state["log"]) > 50:
            state["log"].pop(0)
    print(f"[{t}] {msg}")

# ════════════════════════════════════════════════════════════════
# IR SENSOR CALLBACK
# ════════════════════════════════════════════════════════════════

def ir_triggered(channel=None):
    """
    Called when IR sensor detects an object (GPIO interrupt or manual trigger).
    Starts the full detection + sorting cycle.
    """
    if state["busy"]:
        add_log("IR triggered but system busy — ignoring", "warn")
        return

    add_log("[ IR ] Object detected — starting detection cycle", "ok")
    t = threading.Thread(target=full_cycle, daemon=True)
    t.start()

# ════════════════════════════════════════════════════════════════
# FULL DETECTION + SERVO CYCLE
# ════════════════════════════════════════════════════════════════

def full_cycle():
    """
    Complete waste sorting cycle:
    1. Capture frames → YOLO classify (multi-frame vote)
    2. Servo 1 → rotate to bin angle
    3. Servo 2 → open lid
    4. Wait for waste to fall
    5. Servo 2 → close lid
    6. Wait for IR to clear (object gone from chute)
    7. Both servos → recalibrate to home (0°)
    """
    state["busy"]  = True
    state["step"]  = "DETECTING"

    # ── STEP 1: Multi-frame detection ────────────────────────
    add_log("[ CAM ] Capturing frames for classification...", "info")
    predictions = []
    confidences = []

    for i in range(NUM_FRAMES):
        try:
            if model is not None and camera is not None:
                with cam_lock:
                    ok, frame = camera.read()
                if ok:
                    results  = model(frame, verbose=False)
                    top1     = results[0].names[results[0].probs.top1]
                    conf     = float(results[0].probs.top1conf)
                    label    = normalize_class(top1)
                    predictions.append(label)
                    confidences.append(conf)
                    add_log(f"  Frame {i+1}/{NUM_FRAMES}: {label} ({conf:.0%})", "info")
            else:
                # Demo
                label, conf = demo_predict()
                predictions.append(label)
                confidences.append(conf)
                add_log(f"  Frame {i+1}/{NUM_FRAMES}: {label} ({conf:.0%}) [DEMO]", "info")
        except Exception as e:
            add_log(f"  Frame {i+1} error: {e}", "warn")

        time.sleep(FRAME_DELAY)

    # ── Voting ───────────────────────────────────────────────
    if not predictions:
        add_log("[ ERR ] No predictions — routing to reject", "error")
        majority, avg_conf = "reject", 0.0
    else:
        majority  = Counter(predictions).most_common(1)[0][0]
        avg_conf  = sum(confidences) / len(confidences)
        if avg_conf < CONF_THRESHOLD:
            add_log(f"[ WARN ] Conf {avg_conf:.0%} < threshold → reject", "warn")
            majority = "reject"

    state["last_class"] = majority
    state["confidence"] = avg_conf
    stats[majority]    += 1
    target_angle        = BIN_ANGLES.get(majority, 15)

    add_log(f"[ RESULT ] {majority.upper()} | Conf: {avg_conf:.0%} | Angle: {target_angle}°", "ok")

    # ── STEP 2: Servo 1 — rotate to bin ─────────────────────
    state["step"]         = "ROUTING"
    state["servo1_angle"] = target_angle
    add_log(f"[ SERVO 1 ] Rotating → {majority} bin ({target_angle}°)", "ok")
    move_servo(pwm_router, target_angle, "ROUTER")
    stop_servo(pwm_router)
    time.sleep(WAIT_AFTER_ROUTE)

    # ── STEP 3: Servo 2 — open lid ──────────────────────────
    state["step"]          = "LID OPEN"
    state["servo2_status"] = "OPEN"
    add_log(f"[ SERVO 2 ] Opening lid ({LID_OPEN_ANGLE}°)", "ok")
    move_servo(pwm_lid, LID_OPEN_ANGLE, "LID")

    # ── STEP 4: Conveyor / waste falling ────────────────────
    state["step"]      = "DEPOSITING"
    state["conveyor"]  = "MOVING"
    add_log(f"[ CHUTE ] Waste falling into {majority} bin...", "info")
    time.sleep(WAIT_LID_OPEN)

    # ── STEP 5: Close lid ────────────────────────────────────
    state["servo2_status"] = "CLOSED"
    add_log("[ SERVO 2 ] Closing lid (0°)", "ok")
    move_servo(pwm_lid, LID_CLOSED_ANGLE, "LID")
    stop_servo(pwm_lid)

    # ── STEP 6: Wait for IR to clear (object left chute) ────
    state["step"]     = "WAITING CLEAR"
    state["conveyor"] = "IDLE"
    add_log("[ IR ] Waiting for chute to clear...", "info")

    if ON_RPI:
        timeout = time.time() + 10  # max wait 10s
        while time.time() < timeout:
            if GPIO.input(PIN_IR_SENSOR) == GPIO.HIGH:  # HIGH = no object
                break
            time.sleep(0.1)
    else:
        time.sleep(1.5)  # sim delay

    # ── STEP 7: Recalibrate both servos to home ──────────────
    state["step"] = "RECALIBRATING"
    add_log("[ SYS ] Recalibrating servos to home position (0°)...", "ok")
    time.sleep(WAIT_RECALIBRATE)

    move_servo(pwm_router, SERVO_HOME_ANGLE, "ROUTER")
    time.sleep(0.2)
    move_servo(pwm_lid,    SERVO_HOME_ANGLE, "LID")
    stop_servo(pwm_router)
    stop_servo(pwm_lid)

    state["servo1_angle"]  = SERVO_HOME_ANGLE
    state["servo2_status"] = "CLOSED"
    state["step"]          = "IDLE"
    state["busy"]          = False

    add_log(f"[ SYS ] ✓ Cycle complete — {majority.upper()} sorted | System IDLE", "ok")

# ════════════════════════════════════════════════════════════════
# FLASK ROUTES
# ════════════════════════════════════════════════════════════════

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/video')
def video():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/detect', methods=['POST'])
def detect():
    """Manual trigger (button press) — same as IR trigger."""
    if state["busy"]:
        return jsonify({"status": "busy"})
    ir_triggered()
    return jsonify({"status": "started", "mode": "model" if model else "demo"})

@app.route('/status')
def status():
    return jsonify({
        "class":        state["last_class"],
        "confidence":   round(state["confidence"] * 100, 2),
        "busy":         state["busy"],
        "step":         state["step"],
        "servo1_angle": state["servo1_angle"],
        "servo2":       state["servo2_status"],
        "conveyor":     state["conveyor"],
        "stats":        stats,
        "log":          state["log"][-10:],   # last 10 entries
        "ir":           state["ir_triggered"],
        "model":        model_path_used or "DEMO",
    })

@app.route('/reset', methods=['POST'])
def reset():
    state["last_class"] = "Waiting..."
    state["confidence"] = 0.0
    for k in stats: stats[k] = 0
    add_log("[ SYS ] Stats reset by user", "info")
    return jsonify({"status": "reset"})

@app.route('/recalibrate', methods=['POST'])
def recalibrate():
    """Force both servos back to home."""
    if state["busy"]:
        return jsonify({"status": "busy"})
    add_log("[ SYS ] Manual recalibration triggered", "info")
    move_servo(pwm_router, SERVO_HOME_ANGLE, "ROUTER")
    move_servo(pwm_lid,    SERVO_HOME_ANGLE, "LID")
    stop_servo(pwm_router)
    stop_servo(pwm_lid)
    state["servo1_angle"]  = SERVO_HOME_ANGLE
    state["servo2_status"] = "CLOSED"
    return jsonify({"status": "recalibrated"})

@app.route('/ir_status')
def ir_status():
    """Check IR sensor state."""
    if ON_RPI:
        val = GPIO.input(PIN_IR_SENSOR)
        detected = (val == GPIO.LOW)
    else:
        detected = False
    return jsonify({"detected": detected})

# ════════════════════════════════════════════════════════════════
# STARTUP
# ════════════════════════════════════════════════════════════════

def startup():
    print()
    print("═" * 58)
    print("  QuantumX Smart Segregator — Raspberry Pi Edition")
    print("═" * 58)

    setup_gpio()
    init_camera()
    load_model()

    print()
    print(f"  Mode   : {'HARDWARE (RPi)' if ON_RPI else 'SIMULATION (PC)'}")
    print(f"  Model  : {model_path_used or 'DEMO'}")
    print(f"  Camera : {'Connected' if camera else 'Not found'}")
    print()
    print("  BIN ANGLES:")
    for cls, ang in BIN_ANGLES.items():
        print(f"    {cls:18s} → {ang:3d}°")
    print()
    print("  GPIO PINS:")
    print(f"    Servo 1 (Router) → GPIO {PIN_SERVO_ROUTER}")
    print(f"    Servo 2 (Lid)    → GPIO {PIN_SERVO_LID}")
    print(f"    IR Sensor        → GPIO {PIN_IR_SENSOR}")
    print()
    print("  Open browser: http://localhost:5000")
    print("═" * 58)

# ════════════════════════════════════════════════════════════════
# MAIN
# ════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    startup()
    try:
        app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
    except KeyboardInterrupt:
        print("\n[SYS] Shutting down...")
    finally:
        cleanup_gpio()
        if camera: camera.release()
        print("[SYS] Goodbye.")