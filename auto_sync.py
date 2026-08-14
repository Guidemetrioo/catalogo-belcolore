#!/usr/bin/env python3
"""
auto_sync.py — Sincronizador Automático Periódico (Google Drive -> Catálogo Bel Colore)
=======================================================================================
Este script executa a sincronização contínua a cada N minutos (padrão: 15 minutos).
Pode ser executado diretamente em segundo plano ou agendado no sistema operacional.

USO:
    python auto_sync.py              # Roda em loop contínuo a cada 15 min
    python auto_sync.py --once       # Roda 1 vez e encerra (ideal para Cron / Task Scheduler)
"""

import os
import sys
import time
import argparse
import subprocess

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

INTERVAL_MINUTES = 15

def run_sync(force=False):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n[{timestamp}] 🔄 Iniciando verificação automática com o Google Drive...")
    try:
        cmd = [sys.executable, "sync_catalog.py"]
        if force:
            cmd.append("--force")
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(result.stdout)
        print(f"[{timestamp}] ✅ Sincronização concluída com sucesso!")
    except subprocess.CalledProcessError as e:
        print(f"[{timestamp}] ⚠️ Erro durante a sincronização:")
        print(e.stdout)
        print(e.stderr)

def main():
    parser = argparse.ArgumentParser(description="Auto Sync Daemon Bel Colore")
    parser.add_argument("--once", action="store_true", help="Executa a sincronização apenas uma vez e encerra.")
    parser.add_argument("--force", "-f", action="store_true", help="Força a re-sincronização total de todas as imagens.")
    args = parser.parse_args()

    if args.once:
        run_sync(force=args.force)
        return

    print("=" * 60)
    print(f"🚀 Serviço de Sincronização Automática Ativado!")
    print(f"⏱️ Intervalo de checagem: a cada {INTERVAL_MINUTES} minutos")
    print("Pressione Ctrl+C para encerrar.")
    print("=" * 60)

    try:
        while True:
            run_sync()
            time.sleep(INTERVAL_MINUTES * 60)
    except KeyboardInterrupt:
        print("\nServiço de sincronização encerrado.")

if __name__ == "__main__":
    main()
