#!/usr/bin/env python3
import os
import sys
import re
import json
import time
import shutil
import unicodedata
import argparse
import requests
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

GOOGLE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx4V3LbXg-EgPFXTTuLdBTWqA2AI2oDhqjXA6Mw5XpWr-ByXLMtwNhS56Tkb04Klky6qw/exec"
CATALOG_DIR   = "public/assets/catalog"
PRODUCTS_JSON = "src/data/products.json"
CACHE_FILE    = ".sync_cache.json"
MAX_WIDTH     = 800
WEBP_QUALITY  = 80
MAX_WORKERS   = 15

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def log(msg):
    print(msg, flush=True)

def slugify(text):
    text = unicodedata.normalize("NFKD", str(text))
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^\w\s\-]", "", text, flags=re.UNICODE)
    text = re.sub(r"[\s]+", "-", text.strip())
    return text.lower()

def extract_drive_file_id(url):
    if not url:
        return None
    m = re.search(r"googleusercontent\.com/d/([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)
    m = re.search(r"[?&]id=([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)
    m = re.search(r"/file/d/([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)
    return None

def make_download_url(file_id):
    return f"https://drive.google.com/uc?export=download&id={file_id}"

def make_local_image_path(category, subcategory, name):
    parts = [category]
    if subcategory:
        parts += subcategory.split("/")
    parts = [p for p in parts if p]
    dir_path = "/".join(parts)
    filename = slugify(name) + ".webp"
    return f"/assets/catalog/{dir_path}/{filename}"

def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_cache(cache):
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log(f"   Aviso: Nao foi possivel salvar cache: {e}")

def normalize_item(item, index):
    name     = (item.get("name") or "").strip()
    category = (item.get("category") or "").strip()
    if not name or not category:
        return None

    subcategory  = (item.get("subcategory") or "").strip()
    raw_image    = item.get("image", "")
    raw_url      = item.get("url") or item.get("driveUrl") or item.get("downloadUrl") or ""

    file_id = extract_drive_file_id(raw_image) or extract_drive_file_id(raw_url) or item.get("id")

    if not file_id:
        return None

    local_image = make_local_image_path(category, subcategory, name)
    return {
        "id":           str(index + 1),
        "name":         name,
        "category":     category,
        "image":        local_image,
        "driveId":      file_id,
        "_download_url": raw_url or make_download_url(file_id),
        "_file_id":     file_id,
    }

def fetch_drive_catalog(max_retries=3):
    log("Buscando catalogo do Google Drive...")
    for attempt in range(1, max_retries + 1):
        try:
            url = f"{GOOGLE_APPS_SCRIPT_URL}?t={int(time.time())}"
            log(f"   Tentativa {attempt}/{max_retries}...")
            r = requests.get(url, timeout=180)
            r.encoding = "utf-8"
            r.raise_for_status()
            data = r.json()
            if not isinstance(data, list) or not data:
                raise ValueError(f"Resposta invalida: {type(data)}")
            log(f"   OK: {len(data)} itens recebidos do Drive")
            return data
        except Exception as e:
            log(f"   FALHA tentativa {attempt}: {e}")
            if attempt < max_retries:
                wait = 15 * attempt
                log(f"   Aguardando {wait}s...")
                time.sleep(wait)

    log("ERRO FATAL: Nao foi possivel buscar o catalogo apos retentativas.")
    sys.exit(1)

def get_local_image_paths():
    paths = set()
    if not os.path.isdir(CATALOG_DIR):
        return paths
    for root, _, files in os.walk(CATALOG_DIR):
        for fname in files:
            if not fname.lower().endswith((".webp", ".jpg", ".jpeg", ".png")):
                continue
            full = os.path.join(root, fname).replace("\\", "/")
            if "public/" in full:
                rel = "/" + full.split("public/", 1)[1]
                paths.add(rel)
    return paths

def download_and_save(item, force=False, cache=None):
    image_path = item.get("image", "")
    if not image_path or not image_path.startswith("/assets/catalog/"):
        return False

    local_path = "public" + image_path
    file_id = item.get("_file_id", "")

    if not force and os.path.exists(local_path):
        if cache is not None and file_id:
            cached_fid = cache.get(image_path)
            if cached_fid == file_id:
                return True
        else:
            return True

    os.makedirs(os.path.dirname(local_path), exist_ok=True)

    candidate_urls = []
    if file_id:
        candidate_urls.append(f"https://drive.google.com/thumbnail?id={file_id}&sz=w1600")
        candidate_urls.append(f"https://lh3.googleusercontent.com/d/{file_id}")
        candidate_urls.append(f"https://drive.google.com/uc?export=download&id={file_id}")

    raw_url = item.get("_download_url") or item.get("url") or item.get("driveUrl")
    if raw_url and raw_url.startswith("http") and raw_url not in candidate_urls:
        candidate_urls.append(raw_url)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    for url in candidate_urls:
        delay = 1.0
        for attempt in range(3):
            try:
                r = requests.get(url, timeout=25, allow_redirects=True, headers=headers)
                if r.status_code == 200 and len(r.content) > 500:
                    c_type = r.headers.get("content-type", "").lower()
                    if "text/html" in c_type:
                        break

                    img = Image.open(BytesIO(r.content))
                    if img.mode in ("RGBA", "LA", "P"):
                        img = img.convert("RGB")
                    if img.width > MAX_WIDTH:
                        ratio = MAX_WIDTH / img.width
                        img = img.resize(
                            (MAX_WIDTH, int(img.height * ratio)),
                            Image.Resampling.LANCZOS,
                        )
                    img.save(local_path, "WEBP", quality=WEBP_QUALITY)
                    if cache is not None and file_id:
                        cache[image_path] = file_id
                    return True
                elif r.status_code in (429, 503):
                    time.sleep(delay)
                    delay *= 2
                else:
                    break
            except Exception:
                time.sleep(delay)
                delay *= 2
    return False

def remove_orphaned_images(drive_paths, local_paths):
    orphans = local_paths - drive_paths
    if not orphans:
        log("   OK: Nenhuma imagem orfa para remover")
        return 0

    log(f"   {len(orphans)} imagens que nao existem no Drive — apagando localmente...")
    removed = 0
    for path in sorted(orphans):
        local_file = "public" + path
        try:
            os.remove(local_file)
            removed += 1
        except FileNotFoundError:
            pass

    for root, dirs, files in os.walk(CATALOG_DIR, topdown=False):
        if not os.listdir(root) and root != CATALOG_DIR:
            shutil.rmtree(root, ignore_errors=True)

    log(f"   OK: {removed} imagens removidas")
    return removed

def save_products_json(products):
    os.makedirs(os.path.dirname(PRODUCTS_JSON), exist_ok=True)
    output = []
    for p in products:
        item_data = {
            "id": p["id"],
            "name": p["name"],
            "category": p["category"],
            "image": p["image"],
            "driveId": p["driveId"]
        }
        output.append(item_data)

    with open(PRODUCTS_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    log(f"   OK: {PRODUCTS_JSON} atualizado com {len(output)} itens")

def main():
    parser = argparse.ArgumentParser(description="Sincronizar fotos do Google Drive para o catalogo local WebP")
    parser.add_argument("--force", action="store_true", help="Forçar re-download de todas as imagens")
    args = parser.parse_args()

    log("=" * 60)
    log("  SINCRONIZANDO CATALOGO — Google Drive e a FONTE DE VERDADE")
    log("=" * 60)

    cache = load_cache()
    cache_by_fid = {fid: img_path for img_path, fid in cache.items()}

    # 1. Fetch
    raw_items = fetch_drive_catalog()

    # 2. Normalize
    log("\nNormalizando itens...")
    drive_items = []
    for i, item in enumerate(raw_items):
        norm = normalize_item(item, i)
        if norm:
            drive_items.append(norm)

    log(f"   {len(drive_items)} itens validos normalizados do Drive.")

    # Process renames: if fid exists in cache with old_image != norm["image"]
    renamed_count = 0
    for item in drive_items:
        fid = item["driveId"]
        new_path = item["image"]
        if fid in cache_by_fid:
            old_path = cache_by_fid[fid]
            if old_path != new_path:
                renamed_count += 1
                old_local = "public" + old_path
                new_local = "public" + new_path
                if os.path.exists(old_local):
                    os.makedirs(os.path.dirname(new_local), exist_ok=True)
                    try:
                        shutil.move(old_local, new_local)
                        log(f"   Renomeado foto no disco: {old_path} -> {new_path}")
                    except Exception as e:
                        log(f"   Aviso ao mover {old_path}: {e}")
                if old_path in cache:
                    del cache[old_path]
                cache[new_path] = fid

    if renamed_count > 0:
        log(f"   Renomeacoes processadas: {renamed_count}")
        save_cache(cache)

    drive_paths = {p["image"] for p in drive_items}
    local_paths = get_local_image_paths()

    log(f"\nEstado atual:")
    log(f"   Drive:  {len(drive_items)} itens / {len(drive_paths)} imagens unicas")
    log(f"   Local:  {len(local_paths)} imagens em disco")

    if args.force:
        items_to_download = drive_items
    else:
        items_to_download = []
        for p in drive_items:
            img_p = p["image"]
            fid = p["driveId"]
            if img_p not in local_paths:
                items_to_download.append(p)
            elif fid and img_p in cache and cache[img_p] != fid:
                items_to_download.append(p)
            elif fid and img_p not in cache:
                cache[img_p] = fid

    save_cache(cache)
    items_to_remove = local_paths - drive_paths

    log(f"\n   -> Imagens a baixar/atualizar: {len(items_to_download)}")
    log(f"   -> Imagens a remover:          {len(items_to_remove)}")

    # 3. Remove orphans FIRST
    if items_to_remove:
        log("\n[PASSO 1] Removendo imagens orfas que nao existem no Drive...")
        remove_orphaned_images(drive_paths, local_paths)

    # 4. Download missing / updated
    downloaded = 0
    failed = 0
    if items_to_download:
        log(f"\n[PASSO 2] Baixando/Atualizando {len(items_to_download)} imagens...")
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {
                executor.submit(download_and_save, item, args.force, cache): item
                for item in items_to_download
            }
            for i, future in enumerate(as_completed(futures)):
                ok = future.result()
                if ok:
                    downloaded += 1
                else:
                    failed += 1
                if (i + 1) % 10 == 0 or (i + 1) == len(items_to_download):
                    log(f"   {i+1}/{len(items_to_download)} | Baixadas: {downloaded} | Falhas: {failed}")

        log(f"   Concluido: {downloaded} baixadas, {failed} falhas")
        save_cache(cache)

    # 5. Save products.json (ALL items from Drive!)
    log("\n[PASSO 3] Salvando src/data/products.json...")
    final_products = []
    for p in drive_items:
        local_file = "public" + p["image"]
        if os.path.exists(local_file):
            final_products.append(p)
        else:
            fallback_p = dict(p)
            fallback_p["image"] = p.get("_download_url") or p.get("image")
            final_products.append(fallback_p)

    save_products_json(final_products)
    log("=" * 60)
    log(f"  Sincronizacao concluida com SUCESSO! Total em products.json: {len(final_products)}")
    log("=" * 60)

if __name__ == "__main__":
    main()
