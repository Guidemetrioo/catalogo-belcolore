# download_and_optimize.py
import os
import re
import json
import requests
import sys
from PIL import Image
from io import BytesIO

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
print(f"Loaded {len(data)} items from log.")

# Group by category
# Paths look like "raw_images\\Acessórios - Objetos\\AÇUDE vaso OFF 01.jpg"
# or "Tapetes/Tapetes Tear Manual/ENTRELAÇADO BEGE..."
by_category = {}
for item in data:
    path = item['path'].replace('raw_images\\', '').replace('raw_images/', '')
    # Normalize slashes
    path = path.replace('\\', '/')
    parts = [p for p in path.split('/') if p]
    if len(parts) >= 2:
        category = parts[0]
        by_category.setdefault(category, []).append(item)
    else:
        by_category.setdefault("Outros", []).append(item)

print(f"Found {len(by_category)} categories.")

# Make output dirs
os.makedirs(output_dir, exist_ok=True)
os.makedirs(os.path.dirname(json_output_path), exist_ok=True)

products = []
prod_id = 1

# Limit to 3 files per category
limit = 3

for cat_name, items in sorted(by_category.items()):
    print(f"\nProcessing category: {cat_name} ({len(items)} items available)")
    # Create category output dir
    cat_dir = os.path.join(output_dir, cat_name)
    os.makedirs(cat_dir, exist_ok=True)
    
    downloaded = 0
    for item in items:
        if downloaded >= limit:
            break
            
        url = item['url']
        original_filename = os.path.basename(item['path'])
        name_without_ext, _ = os.path.splitext(original_filename)
        
        # Clean up the name for the product display
        clean_name = name_without_ext.replace('_', ' ').replace('-', ' ').strip()
        # Capitalize words
        clean_name = ' '.join(w.capitalize() for w in clean_name.split())
        
        dest_filename = f"{name_without_ext}.webp"
        dest_path = os.path.join(cat_dir, dest_filename)
        web_image_path = f"/assets/catalog/{cat_name}/{dest_filename}"
        
        print(f"  Downloading: {original_filename}...")
        try:
            r = requests.get(url, timeout=30)
            if r.status_code == 200:
                # Open image and optimize
                img = Image.open(BytesIO(r.content))
                
                # Convert to RGB if in RGBA / P mode
                if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
                    img = img.convert('RGB')
                
                # Resize if width > 1000px
                max_width = 1000
                if img.width > max_width:
                    w_percent = (max_width / float(img.width))
                    h_size = int((float(img.height) * float(w_percent)))
                    img = img.resize((max_width, h_size), Image.Resampling.LANCZOS)
                
                # Save as webp
                img.save(dest_path, "WEBP", quality=80)
                
                products.append({
                    "id": str(prod_id),
                    "name": clean_name,
                    "category": cat_name,
                    "image": web_image_path
                })
                prod_id += 1
                downloaded += 1
                print(f"    Saved and optimized to {dest_path}")
            else:
                print(f"    Failed to download (HTTP {r.status_code})")
        except Exception as e:
            print(f"    Error processing file: {e}")

# Save JSON db
with open(json_output_path, 'w', encoding='utf-8') as f:
    json.dump(products, f, ensure_ascii=False, indent=2)

print(f"\nCompleted! Generated {len(products)} products in {json_output_path}")
