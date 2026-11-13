"""
Entry point untuk Vercel Python Serverless Function.

Vercel akan mengarahkan semua request (lihat vercel.json) ke modul ini.
Vercel mencari objek WSGI bernama `app` secara otomatis.
"""
import os
import sys

# Supaya `import app` (package di root project) bisa ditemukan saat
# dijalankan dari dalam folder /api oleh Vercel runtime.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app  # noqa: E402

app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
