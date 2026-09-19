import requests
import time

API_URL = "http://localhost:8000/api/pipeline"

print("Starting pipeline...")
res = requests.post(f"{API_URL}/start", json={"idea": "A simple blog platform"})
pipeline_id = res.json()["pipeline_id"]
print(f"Pipeline started: {pipeline_id}")

print("Auto-deciding requirements...")
requests.post(f"{API_URL}/{pipeline_id}/interview/auto-decide")

print("Starting architecture...")
requests.post(f"{API_URL}/{pipeline_id}/architecture/start")

print("Polling architecture (expecting 404s until ready)...")
while True:
    arch = requests.get(f"{API_URL}/{pipeline_id}/architecture")
    if arch.status_code == 200:
        print("Success! Architecture generated:")
        print(arch.json()["architecture_summary"])
        break
    else:
        print(f"Status: {arch.status_code}")
    time.sleep(3)
