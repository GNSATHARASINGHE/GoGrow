import os
import traceback
import joblib
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ---- Load model + label encoder ----
MODEL_PATH = os.getenv("CROP_MODEL_PATH", "crop_model.pkl")
LABEL_PATH = os.getenv("CROP_LABEL_PATH", "crop_label_encoder.pkl")

model = joblib.load(MODEL_PATH)              # sklearn Pipeline (preprocessor + classifier)
label_encoder = joblib.load(LABEL_PATH)      # sklearn LabelEncoder
print("Loaded model:", type(model).__name__)

REQUIRED_KEYS = ["Location", "Time", "Soil Condition", "pH"]

def validate_payload(j):
    missing = [k for k in REQUIRED_KEYS if k not in j]
    if missing:
        return f"Missing required keys: {missing}"
    # Basic type checks
    if not isinstance(j["Location"], str) or not j["Location"].strip():
        return "Location must be a non-empty string."
    if not isinstance(j["Time"], str) or j["Time"] not in ("Yala", "Maha"):
        return "Time must be 'Yala' or 'Maha'."
    if not isinstance(j["Soil Condition"], str) or not j["Soil Condition"].strip():
        return "Soil Condition must be a non-empty string."
    try:
        float(j["pH"])
    except Exception:
        return "pH must be numeric."
    return None

def df_from_json(j):
    # Build DataFrame with EXACT columns expected by the Pipeline
    return pd.DataFrame([{
        "Location": j["Location"].strip(),
        "Time": j["Time"],
        "Soil Condition": j["Soil Condition"].strip(),
        "pH": float(j["pH"])
    }])

def format_topk(proba_row, k=3):
    """Return top-k crops with probabilities if classifier supports predict_proba."""
    idx_sorted = proba_row.argsort()[-k:][::-1]
    out = []
    for i in idx_sorted:
        name = label_encoder.inverse_transform([i])[0]
        out.append({"crop": name, "prob": float(proba_row[i])})
    return out

@app.get("/health")
def health():
    return jsonify({"status": "ok"})

# New route matching your updated frontend form
@app.post("/api/crop/recommend")
def api_recommend():
    try:
        j = request.get_json(force=True, silent=False)
        err = validate_payload(j)
        if err:
            return jsonify({"error": err}), 400

        X = df_from_json(j)

        # Predict Top-1
        pred_ids = model.predict(X)
        top1 = label_encoder.inverse_transform(pred_ids)[0]

        # Optional Top-3
        top3 = None
        if hasattr(model, "predict_proba"):
            proba = model.predict_proba(X)[0]
            top3 = format_topk(proba, k=3)

        return jsonify({
            "recommended_crop": top1,
            "top3": top3
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# Backward-compatible route name, now using the new inputs too
@app.post("/predict")
def predict_compat():
    """
    Expects JSON:
    {
      "Location": "Ratnapura",
      "Time": "Yala",
      "Soil Condition": "Sandy loam",
      "pH": 6.3
    }
    """
    try:
        j = request.get_json(force=True, silent=False)
        err = validate_payload(j)
        if err:
            return jsonify({"error": err}), 400

        X = df_from_json(j)
        pred_ids = model.predict(X)
        top1 = label_encoder.inverse_transform(pred_ids)[0]

        top3 = None
        if hasattr(model, "predict_proba"):
            proba = model.predict_proba(X)[0]
            top3 = format_topk(proba, k=3)

        return jsonify({"recommended_crop": top1, "top3": top3})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    # Bind to 0.0.0.0 for Docker/Render, port 5000 by default
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
