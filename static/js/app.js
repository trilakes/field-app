/**
 * Field App - Main JavaScript
 */

// Load projects list
async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        const projects = await response.json();
        
        const container = document.getElementById('projects-list');
        
        if (projects.length === 0) {
            container.innerHTML = '<p class="empty-state">No projects yet. Create one to get started!</p>';
            return;
        }
        
        container.innerHTML = projects.map(p => `
            <a href="/visit/${p.id}" class="project-card">
                <h3>${p.address}</h3>
                <p>Client: ${p.client}</p>
                <span class="project-status ${p.status}">${p.status}</span>
            </a>
        `).join('');
        
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

// New project modal
document.getElementById('new-project-btn')?.addEventListener('click', () => {
    document.getElementById('new-project-modal').classList.add('active');
});

function closeModal() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
}

// Handle new project form
document.getElementById('new-project-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const property = {
        address: formData.get('address'),
        parcel_id: formData.get('parcel_id'),
        client: formData.get('client'),
        client_phone: formData.get('client_phone'),
        acres: parseFloat(formData.get('acres')) || null
    };
    
    try {
        const response = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ property })
        });
        
        const result = await response.json();
        
        if (result.success) {
            window.location.href = `/visit/${result.project_id}`;
        }
    } catch (error) {
        console.error('Error creating project:', error);
        alert('Error creating project');
    }
});

// Close modal on outside click
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
});
