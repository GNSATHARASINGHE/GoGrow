import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
import joblib

# Load dataset
data = pd.read_csv("crop_dataset.csv")  # your actual dataset

# Encode categorical features
label_encoders = {}
for col in ['location', 'season', 'soil_condition', 'recommended_crop']:
    le = LabelEncoder()
    data[col] = le.fit_transform(data[col])
    label_encoders[col] = le

# Features and label
X = data[['location', 'season', 'soil_condition', 'ph']]
y = data['recommended_crop']

# Split data
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Train model
model = RandomForestClassifier(n_estimators=100, random_state=42)
model.fit(X_train, y_train)

# Save model and encoders
joblib.dump(model, 'crop_model.pkl')
joblib.dump(label_encoders, 'label_encoders.pkl')

print("Model trained and saved.")