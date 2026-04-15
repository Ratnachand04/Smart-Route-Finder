"""
Smart Route Finder — Flask REST API
Serves graph data and route computations to the frontend.
Run: python app.py
"""

from pathlib import Path

from flask import Flask, jsonify, request, send_file, Response
from graph_engine import SmartRouter

app = Flask(__name__)
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
BASE_DIR = Path(__file__).resolve().parent

# Try to enable CORS, but continue without it if flask_cors is not installed
try:
    from flask_cors import CORS
    CORS(app)
except ImportError:
    print("Warning: flask_cors not installed. CORS disabled.")

router = SmartRouter()


def _serve_file(filename: str, mimetype: str | None = None):
    """Serve local project files with no-cache headers to avoid stale UI assets."""
    response = send_file(BASE_DIR / filename, mimetype=mimetype, max_age=0, conditional=False)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# ── Graph Data ─────────────────────────────────────

@app.route("/api/graph", methods=["GET"])
def get_graph():
    return jsonify(router.get_graph())

@app.route("/api/nodes", methods=["GET"])
def get_nodes():
    return jsonify(router.get_node_list())

# ── Route Finding ───────────────────────────────────

@app.route("/api/route", methods=["POST"])
def find_route():
    data = request.json
    source = data.get("source", "")
    destination = data.get("destination", "")
    algorithm = data.get("algorithm", "dijkstra")
    result = router.find_route(source, destination, algorithm)
    return jsonify(result)

@app.route("/api/compare", methods=["POST"])
def compare():
    data = request.json
    source = data.get("source", "")
    destination = data.get("destination", "")
    result = router.compare_algorithms(source, destination)
    return jsonify(result)

@app.route("/api/multi-route", methods=["POST"])
def multi_route():
    data = request.json
    source = data.get("source", "")
    destination = data.get("destination", "")
    k = data.get("k", 3)
    result = router.multi_route(source, destination, k)
    return jsonify(result)

# ── Traffic & Simulation ────────────────────────────

@app.route("/api/traffic/simulate", methods=["POST"])
def simulate_traffic():
    data = request.json or {}
    intensity = data.get("intensity", 0.35)
    result = router.simulate_traffic(intensity)
    result["mesh"] = router.get_mesh_config()
    return jsonify(result)

@app.route("/api/traffic/reset", methods=["POST"])
def reset():
    result = router.reset_conditions()
    return jsonify(result)

@app.route("/api/block", methods=["POST"])
def block_road():
    data = request.json
    result = router.block_road(data["from"], data["to"])
    return jsonify(result)

# ── Hex Mesh Persistence APIs ──────────────────────

@app.route("/api/mesh/config", methods=["GET"])
def get_mesh_config():
    return jsonify(router.get_mesh_config())

@app.route("/api/mesh/config", methods=["POST"])
def set_mesh_config():
    data = request.json or {}
    intensity = data.get("intensity")
    seed = data.get("seed")
    pattern_mode = data.get("pattern_mode")
    refinement_factor = data.get("refinement_factor")
    regenerate_seed = bool(data.get("regenerate_seed", False))
    result = router.update_mesh_config(
        intensity=intensity,
        seed=seed,
        regenerate_seed=regenerate_seed,
        pattern_mode=pattern_mode,
        refinement_factor=refinement_factor
    )
    return jsonify(result)

@app.route("/api/mesh/density", methods=["POST"])
def get_mesh_density():
    data = request.json or {}
    cells = data.get("cells", [])
    zoom_level = data.get("zoom_level")
    edge_meters = data.get("edge_meters")
    return jsonify(router.get_mesh_densities(
        cells,
        zoom_level=zoom_level,
        edge_meters=edge_meters
    ))

# ── History ─────────────────────────────────────────

@app.route("/api/history", methods=["GET"])
def get_history():
    return jsonify(router.get_history())

@app.route("/api/history/clear", methods=["POST"])
def clear_history():
    router.history.clear()
    return jsonify({"status": "History cleared"})


@app.route("/")
def index():
    return _serve_file("index.html", mimetype="text/html; charset=utf-8")


@app.route("/styles.css")
def styles():
    return _serve_file("styles.css", mimetype="text/css; charset=utf-8")


@app.route("/app.js")
def script_app():
    return _serve_file("app.js", mimetype="application/javascript; charset=utf-8")


@app.route("/favicon.ico")
def favicon():
    # Avoid noisy browser 404s when requesting a default site icon.
    return Response(status=204)

if __name__ == "__main__":
    print("Smart Route Finder API running at http://localhost:5000")
    app.run(debug=True, port=5000)
