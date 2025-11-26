# retrain_model.py

import pandas as pd
from sklearn.tree import DecisionTreeClassifier
import pickle

# Load your dataset (adjust the path if needed)
df = pd.read_csv("Crop_recommendation.csv")  # Make sure this file exists

# Features and target
X = df[['N', 'P', 'K', 'temperature', 'humidity', 'ph', 'rainfall']]
y = df['label']

# Train a model
model = DecisionTreeClassifier()
model.fit(X, y)

# Save the model
with open("crop_recommendation_model.pkl", "wb") as f:
    pickle.dump(model, f)

print("✅ New model saved as crop_recommendation_model.pkl")
