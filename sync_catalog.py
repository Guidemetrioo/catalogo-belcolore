#!/usr/bin/env python3
"""
sync_catalog.py — Sincronizador Completo do Catalogo Bel Colore
================================================================
Drive e a fonte de verdade. O script:
  1. Busca todos os itens do Drive via Google Apps Script (com retry)
  2. Apaga localmente tudo que nao existe mais no Drive
  3. Baixa imagens novas e converte para WebP
  4. Reconstroi src/data/products.json

COMO USAR:
  python sync_catalog.py

DEPENDENCIAS:
  pip install requests Pillow
"""

import os
import sys
import re
import json
import time
import shutil
import unicodedata
import requests
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed

# ─── Configuracoes ────────────────────────────────────────────────────────────
GOOGLE_APPS_SCRIPT_URL = (
    "https://script.google.com/macros/s/"
    "AKfycbznSFNeB2Bghs-mpM3ET_HnnC46PCkA3fgMqVrbF96xnA7oFCwmXiKrR38KM4M1i7mU"
    "/exec"
)
CATALOG_DIR   = "public/assets/catalog"
PRODUCTS_JSON = "src/data/products.json"
MAX_WIDTH     = 800
WEBP_QUALITY  = 80
MAX_WORKERS   = 10
DRIVE_FOLDER_URL = "https://drive.google.com/drive/u/0/folders/1hnCfnQ9mNqFKzlyOLSbxnMGd-sKsYpdY"
# ──────────────────────────────────────────────────────────────────────────────

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def log(msg):
    print(msg, flush=True)


# ─── Utilitarios ──────────────────────────────────────────────────────────────

def slugify(text):
    """Remove acentos e caracteres especiais, mantendo o nome legivel."""
    text = unicodedata.normalize("NFKD", str(text))
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^\w\s\-]", "", text, flags=re.UNICODE)
    text = re.sub(r"[\s]+", "-", text.strip())
    return text.lower()


def extract_drive_file_id(url):
    """Extrai o file ID do Drive de varios formatos de URL."""
    if not url:
        return None
    # https://lh3.googleusercontent.com/d/FILE_ID
    m = re.search(r"googleusercontent\.com/d/([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)
    # https://drive.google.com/uc?id=FILE_ID
    m = re.search(r"[?&]id=([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)
    # https://drive.google.com/file/d/FILE_ID/
    m = re.search(r"/file/d/([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)
    return None


def make_download_url(file_id):
    return f"https://drive.google.com/uc?export=download&id={file_id}"


def make_local_image_path(category, subcategory, name):
    """Gera o caminho local da imagem a partir de categoria e nome."""
    parts = [category]
    if subcategory:
        parts += subcategory.split("/")
    parts = [p for p in parts if p]
    dir_path = "/".join(parts)
    filename = slugify(name) + ".webp"
    return f"/assets/catalog/{dir_path}/{filename}"


# ─── Cache Manifest ───────────────────────────────────────────────────────────
CACHE_FILE = ".sync_cache.json"

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
    """
    Normaliza um item do Apps Script para o formato padrao:
    Suporta tanto image=URL-do-Google quanto image=/assets/catalog/...
    """
    name     = (item.get("name") or "").strip()
    category = (item.get("category") or "").strip()
    if not name or not category:
        return None

    subcategory  = (item.get("subcategory") or "").strip()
    raw_image    = item.get("image", "")
    raw_url      = item.get("url") or item.get("driveUrl") or item.get("downloadUrl") or ""

    file_id = None
    if raw_image.startswith("http"):
        file_id = extract_drive_file_id(raw_image)
    if not file_id and raw_url.startswith("http"):
        file_id = extract_drive_file_id(raw_url)

    # Caso 1: image e um caminho local e ha url de download separada
    if raw_image.startswith("/assets/catalog/"):
        return {
            "id":           item.get("id", str(index + 1)),
            "name":         name,
            "category":     category,
            "image":        raw_image,
            "_download_url": raw_url,
            "_file_id":     file_id or "",
        }

    if not file_id:
        return None

    local_image = make_local_image_path(category, subcategory, name)
    return {
        "id":           item.get("id", str(index + 1)),
        "name":         name,
        "category":     category,
        "image":        local_image,
        "_download_url": make_download_url(file_id),
        "_file_id":     file_id,
    }


# ─── Fetch Drive ──────────────────────────────────────────────────────────────

def fetch_drive_catalog(max_retries=3):
    log("Buscando catalogo do Google Drive...")
    for attempt in range(1, max_retries + 1):
        try:
            url = f"{GOOGLE_APPS_SCRIPT_URL}?t={int(time.time())}"
            log(f"   Tentativa {attempt}/{max_retries}...")
            r = requests.get(url, timeout=120)
            r.raise_for_status()
            data = r.json()
            if not isinstance(data, list) or not data:
                raise ValueError(f"Resposta invalida: {type(data)}, len={len(data) if isinstance(data, list) else 'N/A'}")
            log(f"   OK: {len(data)} itens recebidos do Drive")
            return data
        except Exception as e:
            log(f"   FALHA tentativa {attempt}: {e}")
            if attempt < max_retries:
                wait = 20 * attempt
                log(f"   Aguardando {wait}s antes de tentar novamente...")
                time.sleep(wait)

    log("ERRO FATAL: Nao foi possivel buscar o catalogo apos 3 tentativas.")
    sys.exit(1)


# ─── Imagens locais ───────────────────────────────────────────────────────────

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


# ─── Download & Convert ───────────────────────────────────────────────────────

def download_and_save(item, force=False, cache=None):
    try:
        from PIL import Image
    except ImportError:
        log("Pillow nao instalado. Execute: pip install Pillow")
        sys.exit(1)

    image_path = item.get("image", "")
    if not image_path or not image_path.startswith("/assets/catalog/"):
        return False

    local_path = "public" + image_path
    file_id = item.get("_file_id", "")

    # Se nao for forçado, verificar se o arquivo existe e o file_id e o mesmo
    if not force and os.path.exists(local_path):
        if cache is not None and file_id:
            cached_fid = cache.get(image_path)
            if cached_fid == file_id:
                return True
        else:
            return True

    os.makedirs(os.path.dirname(local_path), exist_ok=True)

    # Construir lista de URLs de tentativa em ordem de confiabilidade
    candidate_urls = []
    if file_id:
        candidate_urls.append(f"https://lh3.googleusercontent.com/d/{file_id}")
        candidate_urls.append(f"https://drive.google.com/thumbnail?id={file_id}&sz=w1200")
        candidate_urls.append(f"https://drive.google.com/uc?export=download&id={file_id}")

    raw_url = item.get("_download_url") or item.get("url") or item.get("driveUrl") or item.get("downloadUrl")
    if raw_url and raw_url.startswith("http") and raw_url not in candidate_urls:
        candidate_urls.append(raw_url)

    if not candidate_urls:
        return False

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    for url in candidate_urls:
        delay = 1.5
        for attempt in range(3):
            try:
                r = requests.get(url, timeout=30, allow_redirects=True, headers=headers)
                if r.status_code == 200 and len(r.content) > 500:
                    c_type = r.headers.get("content-type", "").lower()
                    if "text/html" in c_type:
                        break  # Tentar a proxima URL candidata se veio HTML de aviso

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


# ─── Remocao de orfaos ────────────────────────────────────────────────────────

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

    # Remove pastas vazias
    for root, dirs, files in os.walk(CATALOG_DIR, topdown=False):
        if not os.listdir(root) and root != CATALOG_DIR:
            shutil.rmtree(root, ignore_errors=True)

    log(f"   OK: {removed} imagens removidas")
    return removed


# ─── Salvar JSON ──────────────────────────────────────────────────────────────

def save_products_json(products):
    os.makedirs(os.path.dirname(PRODUCTS_JSON), exist_ok=True)
    output = [
        {k: v for k, v in p.items() if not k.startswith("_")}
        for p in products
    ]
    with open(PRODUCTS_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    log(f"   OK: {PRODUCTS_JSON} atualizado com {len(output)} itens")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Sincronizador Catalogo Bel Colore")
    parser.add_argument("--force", "-f", action="store_true", help="Forca o re-download e atualizacao de todas as imagens do Drive.")
    args = parser.parse_args()

    log("=" * 60)
    log("  Sincronizador Bel Colore — Google Drive")
    log("  Drive e a FONTE DE VERDADE")
    if args.force:
        log("  [MODO FORÇADO ATIVADO: Re-baixando todas as imagens]")
    log("=" * 60)
    log(f"  Pasta do Drive: {DRIVE_FOLDER_URL}")
    log("")

    cache = load_cache()

    # 1. Buscar catalogo do Drive
    raw_items = fetch_drive_catalog()

    # 2. Normalizar itens (suporta formato antigo e novo do Apps Script)
    log("\nNormalizando itens...")
    drive_items = []
    skipped = 0
    for i, item in enumerate(raw_items):
        normalized = normalize_item(item, i)
        if normalized:
            drive_items.append(normalized)
        else:
            skipped += 1

    log(f"   {len(drive_items)} itens validos ({skipped} ignorados sem URL de download)")

    if not drive_items:
        log("ERRO: Nenhum item valido. Abortando.")
        sys.exit(1)

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
            fid = p.get("_file_id")
            if img_p not in local_paths:
                items_to_download.append(p)
            elif fid and img_p in cache and cache[img_p] != fid:
                # O arquivo existe localmente, mas o ID do Drive mudou -> foto atualizada!
                items_to_download.append(p)
            elif fid and img_p not in cache:
                # Primeira execução com cache: registra o file_id atual
                cache[img_p] = fid

        # Salva o cache inicial se populado
        save_cache(cache)

    items_to_remove = local_paths - drive_paths

    log(f"\n   -> Imagens a baixar/atualizar: {len(items_to_download)}")
    log(f"   -> Imagens a remover:          {len(items_to_remove)}")

    # 3. Remover orfaos PRIMEIRO (Drive e fonte de verdade)
    if items_to_remove:
        log("\n[PASSO 1] Removendo imagens que nao existem no Drive...")
        remove_orphaned_images(drive_paths, local_paths)

    # 4. Baixar imagens novas ou atualizadas
    downloaded = 0
    failed = 0

    if items_to_download:
        log(f"\n[PASSO 2] Baixando/Atualizando {len(items_to_download)} imagens...")
        start = time.time()

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
                if (i + 1) % 25 == 0 or (i + 1) == len(items_to_download):
                    elapsed = time.time() - start
                    speed = (i + 1) / elapsed if elapsed > 0 else 0
                    log(
                        f"   {i+1}/{len(items_to_download)} "
                        f"| OK: {downloaded} | FALHA: {failed} "
                        f"| {speed:.1f} imgs/s"
                    )

        log(f"   Concluido: {downloaded} baixadas/atualizadas, {failed} com falha")
        save_cache(cache)
    else:
        log("\n[PASSO 2] Nenhuma imagem para baixar ou atualizar.")

    # 5. Salvar JSON com itens que tem imagem local
    log("\n[PASSO 3] Salvando catalogo atualizado...")
    valid = [p for p in drive_items if os.path.exists("public" + p["image"])]
    save_products_json(valid)

    log("")
    log("=" * 60)
    log("  Sincronizacao concluida!")
    log(f"     Imagens removidas:  {len(items_to_remove)}")
    log(f"     Imagens baixadas:   {downloaded}")
    log(f"     Falhas de download: {failed}")
    log(f"     Total no catalogo:  {len(valid)}")
    log("=" * 60)
    log("")
    log("Proximo passo: execute 'npm run build' para publicar.")


if __name__ == "__main__":
    main()




