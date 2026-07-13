# Quantum X – Automatic Waste Segregator with Computer Vision

QuantumX is a dual-purpose, research-grade automatic waste segregation platform integrating deep learning computer vision classification, physical hardware controls (Raspberry Pi + Servos + IR Sensors), and a premium responsive monitoring dashboard.

---

## 📸 Dashboard & Hardware Simulation Preview

The dashboard features a real-time MJPEG live video stream, confidence meters, local log terminals, live operations event log, and detailed visual simulation diagrams tracking:
- **GPIO Pin States:** Monitors GPIO 17 (Servo 1), GPIO 27 (Servo 2), and GPIO 22 (IR sensor).
- **Servo 1 Bin Router Dial:** Rotates in real-time to exact angles representing waste categories.
- **Servo 2 Lid & Chute Conveyor Belt:** Animates waste falling into individual slots.
- **Bin Fill Levels & Distribution Graphs:** Tracks item aggregates using Chart.js.

---

## ⚙️ System Architecture

```
Automatic-waste-segregation/
├── backend/                  # Raspberry Pi Flask + YOLO Runtime
│   ├── app.py                # Flask server, camera feed, and GPIO drivers
│   ├── best.pt               # Trained YOLOv8 classification model checkpoint
│   ├── static/               # Assets (CSS/JS) for RPi deployment
│   └── templates/            # Flask index.html template
├── frontend/                 # Vercel-Optimized Static Frontend Dashboard
│   ├── index.html            # Static structure with fallback assets
│   ├── style.css             # Cyberpunk dark mode layout CSS
│   ├── script.js             # Interactive client-side simulation logic
│   └── vercel.json           # Fallback build configurations
├── vercel.json               # Root-level Vercel routing configuration
└── README.md                 # System documentation & deployment guide
```

### Categorization Angles (Servo 1 Router)
* **Reject Waste:** `15°`
* **Metal Waste:** `45°`
* **Organic Waste:** `75°`
* **Plastic Waste:** `105°`
* **Paper Waste:** `135°`
* **E-waste:** `165°`

---

## ⚡ Vercel Deployment (SOC Dashboard Simulator)

Vercel is a serverless hosting provider. Because it cannot run hardware interfaces or persistent camera streams directly, I have implemented an automatic **Standalone Browser Simulation Mode**. 

If the frontend is deployed on Vercel, it gracefully detects the lack of a Flask backend and switches to local simulation. In this mode, clicking **MANUAL TRIGGER** or **RECALIBRATE SERVOS** executes a complete mock classification cycle (randomizing categories, running visual animations on dials, conveyor belts, lids, log records, and Chart.js distribution graphs) client-side in the browser.

### Step-by-Step Deployment
1. Go to your [Vercel Dashboard](https://vercel.com) and click **Add New > Project**.
2. Import this GitHub repository.
3. In the **Configure Project** step, Vercel will automatically read the root [vercel.json](file:///C:/Users/ASUS/.gemini/antigravity-ide/scratch/Automatic-waste-segregation-with-computer-vision/vercel.json) configuration and route all traffic to serve the dashboard.
4. Click **Deploy**. Vercel will compile and host the interface immediately.

---

## 🛠️ Raspberry Pi Physical Setup

To deploy on a physical Raspberry Pi connected to servos, an IR sensor, and a webcam:

### 1. Prerequisite Packages
Install Python dependencies on the RPi:
```bash
pip install flask ultralytics opencv-python RPi.GPIO
```

### 2. Startup Server
Navigate to the backend folder and launch Flask:
```bash
cd backend
python app.py
```
Access the dashboard via the Raspberry Pi IP address: `http://<rpi-ip>:5000`.
