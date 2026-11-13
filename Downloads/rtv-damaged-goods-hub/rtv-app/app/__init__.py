"""
Application factory untuk Sistem RTV & Damaged Goods Hub.
"""
import datetime
import logging

from flask import Flask, jsonify, render_template, session

from .config import get_config
from .security import ApiError


def create_app():
    app = Flask(
        __name__,
        static_folder="static",
        static_url_path="/static",
        template_folder="templates",
    )
    app.config.from_object(get_config())

    logging.basicConfig(level=logging.INFO)

    register_blueprints(app)
    register_error_handlers(app)
    register_misc_routes(app)

    @app.teardown_appcontext
    def close_db(exception=None):
        # Koneksi MongoClient di-cache secara modul-level (lihat app/db.py),
        # jadi tidak perlu ditutup per-request; cukup bersihkan handle `g`.
        pass

    return app


def register_blueprints(app):
    from .blueprints.auth import bp as auth_bp
    from .blueprints.toko import bp as toko_bp
    from .blueprints.gudang import bp as gudang_bp
    from .blueprints.admin_rtv import bp as admin_rtv_bp
    from .blueprints.master_data import bp as master_bp
    from .blueprints.karyawan import bp as karyawan_bp
    from .blueprints.dashboard import bp as dashboard_bp
    from .blueprints.common import bp as common_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(toko_bp, url_prefix="/api/toko")
    app.register_blueprint(gudang_bp, url_prefix="/api/gudang")
    app.register_blueprint(admin_rtv_bp, url_prefix="/api/admin")
    app.register_blueprint(master_bp, url_prefix="/api/master")
    app.register_blueprint(karyawan_bp, url_prefix="/api/karyawan")
    app.register_blueprint(dashboard_bp, url_prefix="/api/dashboard")
    app.register_blueprint(common_bp, url_prefix="/api")


def register_error_handlers(app):
    @app.errorhandler(ApiError)
    def handle_api_error(err):
        response = jsonify(err.to_dict())
        response.status_code = err.status_code
        return response

    @app.errorhandler(404)
    def handle_404(err):
        return jsonify({"error": "not_found", "message": "Endpoint tidak ditemukan."}), 404

    @app.errorhandler(405)
    def handle_405(err):
        return jsonify({"error": "method_not_allowed", "message": "Metode HTTP tidak diizinkan."}), 405

    @app.errorhandler(413)
    def handle_413(err):
        return jsonify({"error": "payload_too_large", "message": "Ukuran request terlalu besar."}), 413

    @app.errorhandler(Exception)
    def handle_unexpected(err):
        app.logger.exception("Unhandled exception")
        return (
            jsonify(
                {
                    "error": "internal_error",
                    "message": "Terjadi kesalahan pada server. Silakan coba lagi.",
                }
            ),
            500,
        )


def register_misc_routes(app):
    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/health")
    def health():
        from .db import ping

        return jsonify(
            {
                "status": "ok" if ping() else "degraded",
                "time": datetime.datetime.utcnow().isoformat() + "Z",
            }
        )

    # SPA fallback: route non-/api, non-/static path ke index.html supaya
    # refresh di halaman mana pun tetap jalan.
    @app.get("/<path:path>")
    def spa_fallback(path):
        if path.startswith("api/") or path.startswith("static/"):
            return jsonify({"error": "not_found", "message": "Endpoint tidak ditemukan."}), 404
        return render_template("index.html")
