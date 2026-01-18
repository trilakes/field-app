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
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Load .env file (for local development)
load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
CORS(app)

# Database connection
DATABASE_URL = os.environ.get('DATABASE_URL')

def get_db():
    """Get database connection"""
    if not DATABASE_URL:
        return None
    conn = psycopg2.connect(DATABASE_URL)
    return conn

def init_db():
    """Initialize database tables"""
    if not DATABASE_URL:
        print("No DATABASE_URL - using file storage")
        return
    
    conn = get_db()
    cur = conn.cursor()
    
    # Create projects table
    cur.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id VARCHAR(50) PRIMARY KEY,
            user_email VARCHAR(255) NOT NULL,
            address TEXT,
            parcel_id VARCHAR(50),
            client_name VARCHAR(255),
            client_phone VARCHAR(50),
            client_email VARCHAR(255),
            acres DECIMAL(10,2),
            status VARCHAR(20) DEFAULT 'pending',
            visit_data JSONB DEFAULT '{}',
            notes TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create GPS points table
    cur.execute('''
        CREATE TABLE IF NOT EXISTS gps_points (
            id SERIAL PRIMARY KEY,
            project_id VARCHAR(50) REFERENCES projects(id) ON DELETE CASCADE,
            label VARCHAR(255),
            lat DECIMAL(10,7),
            lon DECIMAL(10,7),
            altitude_m DECIMAL(10,2),
            elevation_ft INTEGER,
            accuracy DECIMAL(10,2),
            point_type VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create photos table
    cur.execute('''
        CREATE TABLE IF NOT EXISTS photos (
            id SERIAL PRIMARY KEY,
            project_id VARCHAR(50) REFERENCES projects(id) ON DELETE CASCADE,
            label VARCHAR(255),
            filename VARCHAR(255),
            data TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    cur.close()
    conn.close()
    print("Database initialized!")

# Initialize database on startup
try:
    init_db()
except Exception as e:
    print(f"Database init error: {e}")

# Authentication - users stored in environment or defaults
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

# File storage fallback
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
PROJECTS_DIR = DATA_DIR / "projects"
PHOTOS_DIR = DATA_DIR / "photos"
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

@app.route('/sw.js')
def service_worker():
    """Serve service worker from root"""
    return send_file('static/sw.js', mimetype='application/javascript')

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
    """List all projects for current user"""
    user_email = session.get('user')
    
    if DATABASE_URL:
        conn = get_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute('''
            SELECT id, address, client_name as client, status, created_at 
            FROM projects WHERE user_email = %s ORDER BY created_at DESC
        ''', (user_email,))
        projects = cur.fetchall()
        cur.close()
        conn.close()
        return jsonify([dict(p) for p in projects])
    else:
        # Fallback to file storage
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
    user_email = session.get('user')
    data = request.json
    prop = data.get('property', {})
    project_id = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    if DATABASE_URL:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''
            INSERT INTO projects (id, user_email, address, parcel_id, client_name, client_phone, acres, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending')
        ''', (
            project_id,
            user_email,
            prop.get('address'),
            prop.get('parcel_id'),
            prop.get('client'),
            prop.get('client_phone'),
            prop.get('acres')
        ))
        conn.commit()
        cur.close()
        conn.close()
    else:
        # Fallback to file storage
        project = {
            'id': project_id,
            'created': datetime.now().isoformat(),
            'status': 'pending',
            'property': prop,
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
@login_required
def get_project(project_id):
    """Get project details"""
    user_email = session.get('user')
    
    if DATABASE_URL:
        conn = get_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Get project
        cur.execute('SELECT * FROM projects WHERE id = %s AND user_email = %s', (project_id, user_email))
        project = cur.fetchone()
        
        if not project:
            cur.close()
            conn.close()
            return jsonify({'error': 'Project not found'}), 404
        
        # Get GPS points
        cur.execute('SELECT * FROM gps_points WHERE project_id = %s ORDER BY created_at', (project_id,))
        gps_points = cur.fetchall()
        
        # Get photos
        cur.execute('SELECT * FROM photos WHERE project_id = %s ORDER BY created_at', (project_id,))
        photos = cur.fetchall()
        
        cur.close()
        conn.close()
        
        return jsonify({
            'id': project['id'],
            'status': project['status'],
            'property': {
                'address': project['address'],
                'parcel_id': project['parcel_id'],
                'client': project['client_name'],
                'client_phone': project['client_phone'],
                'acres': float(project['acres']) if project['acres'] else None,
                'center_lat': 39.160840,  # Default, could store in DB
                'center_lon': -104.932185
            },
            'visit_data': project['visit_data'] or {},
            'gps_points': [dict(p) for p in gps_points],
            'photos': [dict(p) for p in photos],
            'notes': project['notes'] or ''
        })
    else:
        # Fallback to file storage
        project_file = PROJECTS_DIR / f"{project_id}.json"
        if not project_file.exists():
            return jsonify({'error': 'Project not found'}), 404
        with open(project_file) as f:
            return jsonify(json.load(f))

@app.route('/api/projects/<project_id>', methods=['PUT'])
@login_required
def update_project(project_id):
    """Update project data"""
    user_email = session.get('user')
    data = request.json
    
    if DATABASE_URL:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''
            UPDATE projects SET visit_data = %s, notes = %s, updated_at = CURRENT_TIMESTAMP
            WHERE id = %s AND user_email = %s
        ''', (json.dumps(data.get('visit_data', {})), data.get('notes', ''), project_id, user_email))
        conn.commit()
        cur.close()
        conn.close()
    else:
        project_file = PROJECTS_DIR / f"{project_id}.json"
        if not project_file.exists():
            return jsonify({'error': 'Project not found'}), 404
        data['updated'] = datetime.now().isoformat()
        with open(project_file, 'w') as f:
            json.dump(data, f, indent=2)
    
    return jsonify({'success': True})

@app.route('/api/projects/<project_id>/gps', methods=['POST'])
@login_required
def add_gps_point(project_id):
    """Add a GPS point to project"""
    gps_data = request.json
    
    if DATABASE_URL:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''
            INSERT INTO gps_points (project_id, label, lat, lon, altitude_m, elevation_ft, accuracy, point_type)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ''', (
            project_id,
            gps_data.get('label'),
            gps_data.get('lat'),
            gps_data.get('lon'),
            gps_data.get('altitude_m'),
            gps_data.get('elevation_ft'),
            gps_data.get('accuracy'),
            gps_data.get('type')
        ))
        conn.commit()
        cur.execute('SELECT COUNT(*) FROM gps_points WHERE project_id = %s', (project_id,))
        count = cur.fetchone()[0]
        cur.close()
        conn.close()
        return jsonify({'success': True, 'point_count': count})
    else:
        project_file = PROJECTS_DIR / f"{project_id}.json"
        if not project_file.exists():
            return jsonify({'error': 'Project not found'}), 404
        with open(project_file) as f:
            project = json.load(f)
        gps_data['timestamp'] = datetime.now().isoformat()
        project['gps_points'].append(gps_data)
        with open(project_file, 'w') as f:
            json.dump(project, f, indent=2)
        return jsonify({'success': True, 'point_count': len(project['gps_points'])})

@app.route('/api/projects/<project_id>/photo', methods=['POST'])
@login_required
def add_photo(project_id):
    """Add a photo to project"""
    data = request.json
    photo_data = data.get('photo')  # Base64 encoded
    label = data.get('label', 'Photo')
    
    if not photo_data:
        return jsonify({'error': 'No photo data'}), 400
    
    photo_id = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    
    # Strip base64 header if present
    if ',' in photo_data:
        photo_data = photo_data.split(',')[1]
    
    if DATABASE_URL:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''
            INSERT INTO photos (project_id, label, filename, data)
            VALUES (%s, %s, %s, %s)
        ''', (project_id, label, f"{photo_id}.jpg", photo_data))
        conn.commit()
        cur.close()
        conn.close()
    else:
        photo_filename = f"{project_id}_{photo_id}.jpg"
        photo_path = PHOTOS_DIR / photo_filename
        with open(photo_path, 'wb') as f:
            f.write(base64.b64decode(photo_data))
        
        project_file = PROJECTS_DIR / f"{project_id}.json"
        if project_file.exists():
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

@app.route('/api/projects/<project_id>/export', methods=['GET'])
@login_required
def export_project(project_id):
    """Export project as JSON"""
    if DATABASE_URL:
        # For DB, just return the project data
        return get_project(project_id)
    else:
        project_file = PROJECTS_DIR / f"{project_id}.json"
        if not project_file.exists():
            return jsonify({'error': 'Project not found'}), 404
        return send_file(project_file, as_attachment=True)

@app.route('/photos/<filename>')
@login_required
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
