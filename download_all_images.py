# download_all_images.py
import os
import re
import json
import requests
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image
from io import BytesIO

# Reconfigure stdout to support utf-8 encoding
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\guide\.gemini\antigravity-ide\brain\e89d82b4-f8e3-4dc8-af0c-2fb699c8488b\.system_generated\tasks\task-128.log"
output_dir = r"public/assets/catalog"
json_output_path = r"src/data/products.json"

print("Reading gdown log...")
with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# Find the JSON array
match = re.search(r'(\[.*\])', content, re.DOTALL)
if not match:
    print("Could not find JSON array in log!")
    exit(1)

data = json.loads(match.group(1))
total_items = len(data)
print(f"Loaded {total_items} items from log.")

# Create main catalog directory
os.makedirs(output_dir, exist_ok=True)
os.makedirs(os.path.dirname(json_output_path), exist_ok=True)

# Lock or counter for logging progress
completed_count = 0

def download_and_optimize_file(item, index):
    global completed_count
    url = item['url']
    
    # Mapear categoria a partir do path
    path = item['path'].replace('raw_images\\', '').replace('raw_images/', '')
    path = path.replace('\\', '/')
    parts = [p for p in path.split('/') if p]
    
    if len(parts) >= 2:
        cat_name = parts[0]
    else:
        cat_name = "Outros"
        
    original_filename = os.path.basename(item['path'])
    name_without_ext, _ = os.path.splitext(original_filename)
    
    # Clean up the name for the product display
    clean_name = name_without_ext.replace('_', ' ').replace('-', ' ').strip()
    clean_name = ' '.join(w.capitalize() for w in clean_name.split())
    
    dest_filename = f"{name_without_ext}.webp"
    cat_dir = os.path.join(output_dir, cat_name)
    
    # Garantir que a pasta da categoria existe
    # Thread-safe directory creation using exist_ok=True
    os.makedirs(cat_dir, exist_ok=True)
    
    dest_path = os.path.join(cat_dir, dest_filename)
    web_image_path = f"/assets/catalog/{cat_name}/{dest_filename}"
    
    product_meta = {
        "id": str(index + 1),
        "name": clean_name,
        "category": cat_name,
        "image": web_image_path
    }
    
    # Se o arquivo já existe (ex: as 69 imagens que baixamos anteriormente), pulamos o download
    if os.path.exists(dest_path):
        return product_meta

    # Download with retry mechanism
    retries = 3
    delay = 2
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=20)
            if r.status_code == 200:
                img = Image.open(BytesIO(r.content))
                
                # Convert to RGB
                if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
                    img = img.convert('RGB')
                
                # Resize to max 600px width for extreme lightweight files (approx 15-20KB each)
                max_width = 600
                if img.width > max_width:
                    w_percent = (max_width / float(img.width))
                    h_size = int((float(img.height) * float(w_percent)))
                    img = img.resize((max_width, h_size), Image.Resampling.LANCZOS)
                
                img.save(dest_path, "WEBP", quality=75)
                return product_meta
                
            elif r.status_code in (429, 403, 503):
                # Rate limit or temporary error, sleep and retry
                time.sleep(delay)
                delay *= 2
            else:
                # Other HTTP errors
                break
        except Exception as e:
            # Connection errors, timeout, etc.
            time.sleep(delay)
            delay *= 2
            
    return None # Return None if all retries failed

products = []
failed_count = 0

print("Starting parallel download of all 4331 files using 25 workers...")
start_time = time.time()

with ThreadPoolExecutor(max_workers=25) as executor:
    futures = {executor.submit(download_and_optimize_file, item, idx): idx for idx, item in enumerate(data)}
    
    for idx, future in enumerate(as_completed(futures)):
        res = future.result()
        if res:
            products.append(res)
        else:
            failed_count += 1
        
        completed_count += 1
        if completed_count % 50 == 0 or completed_count == total_items:
            elapsed = time.time() - start_time
            speed = completed_count / elapsed if elapsed > 0 else 0
            eta = (total_items - completed_count) / speed if speed > 0 else 0
            print(f"Progress: {completed_count}/{total_items} ({(completed_count/total_items)*100:.1f}%) | Success: {len(products)} | Failed: {failed_count} | Speed: {speed:.1f} files/s | ETA: {eta/60:.1f} min")
            
            # Incremental save to keep the database updated in real-time
            try:
                with open(json_output_path, 'w', encoding='utf-8') as f:
                    json.dump(products, f, ensure_ascii=False, indent=2)
            except Exception as e:
                print(f"Error saving database incrementally: {e}")

# Save final products.json database
with open(json_output_path, 'w', encoding='utf-8') as f:
    json.dump(products, f, ensure_ascii=False, indent=2)

print(f"\nFinished! Total products saved: {len(products)} (Failed downloads: {failed_count})")
print(f"Time elapsed: {(time.time() - start_time)/60:.2f} minutes")
