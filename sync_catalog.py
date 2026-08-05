#!/usr/bin/env python3
"""
sync_catalog.py — Sincronizador Completo do Catalogo Bel Colore
================================================================
Executa a sincronizacao completa entre o Google Drive e o catalogo local:
  1. Busca a lista atual de arquivos via Google Apps Script
  2. Compara com os arquivos locais em public/assets/catalog/
  3. Baixa imagens novas e converte para WebP
  4. Remove imagens que foram deletadas do Drive
  5. Reconstroi src/data/products.json

COMO USAR:
  python sync_catalog.py

DEPENDENCIAS:
  pip install requests Pillow
"""

import os
import sys
import json
import time
import shutil
import requests
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed

# ─── Configuracoes ────────────────────────────────────────────────────────────
GOOGLE_APPS_SCRIPT_URL = (
    "https://script.google.com/macros/s/"
    "AKfycbznSFNeB2Bghs-mpM3ET_HnnC46PCkA3fgMqVrbF96xnA7oFCwmXiKrR38KM4M1i7mU"
    "/exec"
)
CATALOG_DIR = "public/assets/catalog"
PRODUCTS_JSON = "src/data/products.json"
MAX_WIDTH = 600
WEBP_QUALITY = 75
MAX_WORKERS = 20
DRIVE_FOLDER_URL = "https://drive.google.com/drive/u/0/folders/1hnCfnQ9mNqFKzlyOLSbxnMGd-sKsYpdY"
# ──────────────────────────────────────────────────────────────────────────────

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def log(msg):
    print(msg, flush=True)


def fetch_drive_catalog():
    log("Buscando catalogo do Google Drive...")
    try:
        url = f"{GOOGLE_APPS_SCRIPT_URL}?t={int(time.time())}"
        res = requests.get(url, timeout=60)
        res.raise_for_status()
        data = res.json()
        if not isinstance(data, list):
            raise ValueError(f"Resposta inesperada do script: {type(data)}")
        log(f"   OK: {len(data)} itens recebidos do Drive")
        return data
    except Exception as e:
        log(f"   FALHA ao buscar catalogo: {e}")
        sys.exit(1)


def load_local_products():
    try:
        with open(PRODUCTS_JSON, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def get_local_image_paths():
    paths = set()
    if not os.path.isdir(CATALOG_DIR):
        return paths
    for root, _, files in os.walk(CATALOG_DIR):
        for fname in files:
            full = os.path.join(root, fname)
            rel = full.replace("\\", "/")
            if rel.startswith("public/"):
                rel = rel[len("public"):]
            paths.add(rel)
    return paths


def download_and_save(item, index):
    try:
        from PIL import Image
    except ImportError:
        log("Pillow nao instalado. Execute: pip install Pillow")
        sys.exit(1)

    image_path = item.get("image", "")
    if not image_path or not image_path.startswith("/assets/catalog/"):
        return None

    local_path = "public" + image_path
    os.makedirs(os.path.dirname(local_path), exist_ok=True)

    if os.path.exists(local_path):
        return item

    url = item.get("url") or item.get("driveUrl") or item.get("downloadUrl")
    if not url or url.startswith("/assets/"):
        return None

    retries = 3
    delay = 2
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=30)
            if r.status_code == 200:
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
                return item
            elif r.status_code in (429, 503):
                time.sleep(delay)
                delay *= 2
            else:
                break
        except Exception:
            time.sleep(delay)
            delay *= 2
    return None


def remove_orphaned_images(drive_paths, local_paths):
    orphans = local_paths - drive_paths
    if not orphans:
        log("   OK: Nenhuma imagem orfã para remover")
        return 0

    log(f"   {len(orphans)} imagens removidas do Drive — apagando localmente...")
    removed = 0
    for path in sorted(orphans):
        local_file = "public" + path
        try:
            os.remove(local_file)
            log(f"      - Removido: {path}")
            removed += 1
        except FileNotFoundError:
            pass

    for cat_dir in os.listdir(CATALOG_DIR):
        full_cat = os.path.join(CATALOG_DIR, cat_dir)
        if os.path.isdir(full_cat) and not os.listdir(full_cat):
            shutil.rmtree(full_cat)
            log(f"      - Pasta vazia removida: {cat_dir}/")
    return removed


def save_products_json(products):
    os.makedirs(os.path.dirname(PRODUCTS_JSON), exist_ok=True)
    with open(PRODUCTS_JSON, "w", encoding="utf-8") as f:
        json.dump(products, f, ensure_ascii=False, indent=2)
    log(f"   OK: {PRODUCTS_JSON} atualizado com {len(products)} itens")


def main():
    log("=" * 60)
    log("  Sincronizador Bel Colore — Google Drive")
    log("=" * 60)
    log(f"  Pasta do Drive: {DRIVE_FOLDER_URL}")
    log("")

    drive_products = fetch_drive_catalog()
    if not drive_products:
        log("ERRO: Lista vazia retornada. Abortando para evitar apagar o catalogo.")
        sys.exit(1)

    drive_paths = {p.get("image", "") for p in drive_products if p.get("image")}

    local_paths = get_local_image_paths()
    local_products = load_local_products()

    log(f"\nEstado atual:")
    log(f"   Drive:  {len(drive_products)} itens / {len(drive_paths)} imagens unicas")
    log(f"   Local:  {len(local_products)} itens / {len(local_paths)} imagens em disco")

    new_paths = drive_paths - local_paths
    items_to_download = [p for p in drive_products if p.get("image") in new_paths]

    log(f"\nImagens novas a baixar: {len(items_to_download)}")
    log(f"Imagens a remover: {len(local_paths - drive_paths)}")

    if not items_to_download and not (local_paths - drive_paths):
        log("\nCatalogo ja esta sincronizado! Nenhuma alteracao necessaria.")
        save_products_json(drive_products)
        return

    downloaded = 0
    failed = 0

    if items_to_download:
        log(f"\nBaixando {len(items_to_download)} imagens novas...")
        start = time.time()

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {
                executor.submit(download_and_save, item, idx): idx
                for idx, item in enumerate(items_to_download)
            }
            for i, future in enumerate(as_completed(futures)):
                res = future.result()
                if res:
                    downloaded += 1
                else:
                    failed += 1
                if (i + 1) % 20 == 0 or (i + 1) == len(items_to_download):
                    elapsed = time.time() - start
                    speed = (i + 1) / elapsed if elapsed > 0 else 0
                    log(
                        f"   {i+1}/{len(items_to_download)} "
                        f"| OK: {downloaded} | FALHA: {failed} "
                        f"| {speed:.1f} imgs/s"
                    )

        log(f"   Concluido: {downloaded} baixadas, {failed} com falha")

    log("\nVerificando imagens removidas do Drive...")
    removed = remove_orphaned_images(drive_paths, get_local_image_paths())

    log("\nSalvando catalogo atualizado...")
    valid_products = [
        p for p in drive_products
        if p.get("image") and os.path.exists("public" + p["image"])
    ]
    save_products_json(valid_products)

    log("")
    log("=" * 60)
    log(f"  Sincronizacao completa!")
    log(f"     Imagens novas: {downloaded}")
    log(f"     Imagens removidas: {removed}")
    log(f"     Total no catalogo: {len(valid_products)}")
    log("=" * 60)
    log("")
    log("Agora execute 'npm run build' para aplicar as mudancas no site.")


if __name__ == "__main__":
    main()


