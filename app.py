"""
Field Site Visit App
Mobile-friendly Flask app for collecting site visit data
"""
from flask import Flask, render_template, request, jsonify, send_file, redirect, url_for, session
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import os
import json
from datetime import datetime
from pathlib import Path
import base64

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
CORS(app)

# Authentication - users stored in environment or defaults
# In production, set these as environment variables in Render
USERS = {
    os.environ.get('ADMIN_EMAIL', 'kyle@trilakes.co'): {
        'password_hash': generate_password_hash(os.environ.get('ADMIN_PASSWORD', 'changeme')),
        'name': 'Kyle'
    }
}

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# Data storage
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
PROJECTS_DIR = DATA_DIR / "projects"
PHOTOS_DIR = DATA_DIR / "photos"

# Ensure directories exist
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

@app.route('/login', methods=['GET', 'POST'])
def login():
    """Login page"""
    if request.method == 'POST':
        email = request.form.get('email', '').lower().strip()
        password = request.form.get('password', '')
        
        if email in USERS and check_password_hash(USERS[email]['password_hash'], password):
            session['user'] = email
            session['name'] = USERS[email]['name']
            return redirect(url_for('index'))
        else:
            return render_template('login.html', error='Invalid email or password')
    
    return render_template('login.html')

@app.route('/logout')
def logout():
    """Logout"""
    session.clear()
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    """Main app page"""
    return render_template('index.html')

@app.route('/visit/<project_id>')
@login_required
def visit(project_id):
    """Site visit form for a specific project"""
    return render_template('visit.html', project_id=project_id)

@app.route('/api/projects', methods=['GET'])
@login_required
def list_projects():
    """List all projects"""
    projects = []
    for f in PROJECTS_DIR.glob('*.json'):
        with open(f) as file:
            data = json.load(file)
            projects.append({
                'id': f.stem,
                'address': data.get('property', {}).get('address', 'Unknown'),
                'client': data.get('property', {}).get('client', 'Unknown'),
                'created': data.get('created', ''),
                'status': data.get('status', 'pending')
            })
    return jsonify(projects)

@app.route('/api/projects', methods=['POST'])
@login_required
def create_project():
    """Create a new project"""
    data = request.json
    project_id = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    project = {
        'id': project_id,
        'created': datetime.now().isoformat(),
        'status': 'pending',
        'property': data.get('property', {}),
        'visit_data': {},
        'gps_points': [],
        'photos': [],
        'notes': ''
    }
    
    project_file = PROJECTS_DIR / f"{project_id}.json"
    with open(project_file, 'w') as f:
        json.dump(project, f, indent=2)
    
    return jsonify({'success': True, 'project_id': project_id})

@app.route('/api/projects/<project_id>', methods=['GET'])
def get_project(project_id):
    """Get project details"""
    project_file = PROJECTS_DIR / f"{project_id}.json"
    if not project_file.exists():
        return jsonify({'error': 'Project not found'}), 404
    
    with open(project_file) as f:
        return jsonify(json.load(f))

@app.route('/api/projects/<project_id>', methods=['PUT'])
def update_project(project_id):
    """Update project data"""
    project_file = PROJECTS_DIR / f"{project_id}.json"
    if not project_file.exists():
        return jsonify({'error': 'Project not found'}), 404
    
    data = request.json
    data['updated'] = datetime.now().isoformat()
    
    with open(project_file, 'w') as f:
        json.dump(data, f, indent=2)
    
    return jsonify({'success': True})

@app.route('/api/projects/<project_id>/gps', methods=['POST'])
def add_gps_point(project_id):
    """Add a GPS point to project"""
    project_file = PROJECTS_DIR / f"{project_id}.json"
    if not project_file.exists():
        return jsonify({'error': 'Project not found'}), 404
    
    with open(project_file) as f:
        project = json.load(f)
    
    gps_data = request.json
    gps_data['timestamp'] = datetime.now().isoformat()
    project['gps_points'].append(gps_data)
    
    with open(project_file, 'w') as f:
        json.dump(project, f, indent=2)
    
    return jsonify({'success': True, 'point_count': len(project['gps_points'])})

@app.route('/api/projects/<project_id>/photo', methods=['POST'])
def add_photo(project_id):
    """Add a photo to project"""
    project_file = PROJECTS_DIR / f"{project_id}.json"
    if not project_file.exists():
        return jsonify({'error': 'Project not found'}), 404
    
    data = request.json
    photo_data = data.get('photo')  # Base64 encoded
    label = data.get('label', 'Photo')
    
    if photo_data:
        # Save photo to file
        photo_id = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        photo_filename = f"{project_id}_{photo_id}.jpg"
        photo_path = PHOTOS_DIR / photo_filename
        
        # Decode base64 and save
        if ',' in photo_data:
            photo_data = photo_data.split(',')[1]
        
        with open(photo_path, 'wb') as f:
            f.write(base64.b64decode(photo_data))
        
        # Update project
        with open(project_file) as f:
            project = json.load(f)
        
        project['photos'].append({
            'id': photo_id,
            'filename': photo_filename,
            'label': label,
            'timestamp': datetime.now().isoformat(),
            'gps': data.get('gps', {})
        })
        
        with open(project_file, 'w') as f:
            json.dump(project, f, indent=2)
        
        return jsonify({'success': True, 'photo_id': photo_id})
    
    return jsonify({'error': 'No photo data'}), 400

@app.route('/api/projects/<project_id>/export', methods=['GET'])
def export_project(project_id):
    """Export project as JSON"""
    project_file = PROJECTS_DIR / f"{project_id}.json"
    if not project_file.exists():
        return jsonify({'error': 'Project not found'}), 404
    
    return send_file(project_file, as_attachment=True)

@app.route('/photos/<filename>')
def serve_photo(filename):
    """Serve a photo"""
    return send_file(PHOTOS_DIR / filename)

# Pre-load Rodrigo's project
def create_rodrigo_project():
    """Create the default project for Rodrigo"""
    project_id = 'rodrigo_boulder_lane'
    project_file = PROJECTS_DIR / f"{project_id}.json"
    
    if not project_file.exists():
        project = {
            'id': project_id,
            'created': datetime.now().isoformat(),
            'status': 'pending',
            'property': {
                'address': '13910 Boulder Lane, Larkspur, CO 80118',
                'parcel_id': '277119403010',
                'legal': 'Lot 65, Woodmoor Mountain 3',
                'acres': 3.79,
                'owner': 'Thomas & Rachel Watson',
                'asking_price': 65000,
                'client': 'Rodrigo Dominguez',
                'client_phone': '281-901-8349',
                'client_email': 'eldude.rodrigo@gmail.com',
                'elevation_range': '7,405 - 8,203 ft',
                'relief': '798 ft',
                'center_lat': 39.160840,
                'center_lon': -104.932185
            },
            'visit_data': {
                'arrival': {},
                'access': {},
                'build_site': {},
                'septic': {},
                'soils': {},
                'well': {},
                'utilities': {},
                'vegetation': {},
                'assessment': {}
            },
            'gps_points': [],
            'photos': [],
            'notes': ''
        }
        
        with open(project_file, 'w') as f:
            json.dump(project, f, indent=2)

# Initialize
create_rodrigo_project()

if __name__ == '__main__':
    # Get port from environment variable (for Render) or use 5050 for local
    port = int(os.environ.get('PORT', 5050))
    debug = os.environ.get('FLASK_DEBUG', 'true').lower() == 'true'
    
    print("\n" + "="*50)
    print("🏔️  FIELD SITE VISIT APP")
    print("="*50)
    print(f"\nRunning on port {port}")
    print("Press Ctrl+C to stop\n")
    app.run(host='0.0.0.0', port=port, debug=debug)
