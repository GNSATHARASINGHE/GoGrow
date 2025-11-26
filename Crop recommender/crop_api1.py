import pickle
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Enable cross-origin requests from Node.js

# Load model
model = pickle.load(open("crop_recommendation_model.pkl", "rb"))
print("Loaded model type:", type(model))


@app.route('/predict', methods=['POST'])
def predict():
    data = request.json
    features = [
        data["N"], data["P"], data["K"],
        data["temperature"], data["humidity"],
        data["ph"], data["rainfall"]
    ]
    prediction = model.predict([features])[0]
    return jsonify({"recommended_crop": prediction})

if __name__ == '__main__':
    app.run(port=5000)
