import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = 5173;

app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increase payload limit for wall data

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Serve static tiles (keep existing functionality)
app.use("/tiles", express.static(path.join(__dirname, "../../client/public/tiles")));

app.get('/', (req, res) => {
    res.send('School Navigation API Running');
});

// Validation helper for nodes
function isValidNode(node: any): boolean {
    return (
        node &&
        typeof node.uid === 'string' &&
        Array.isArray(node.rooms) &&
        typeof node.lat === 'number' &&
        typeof node.lng === 'number' &&
        (node.type === undefined || typeof node.type === 'string')
    );
}

// Save nodes endpoint (floor-aware)
app.post('/api/nodes', (req, res) => {
    try {
        const nodes = req.body;
        const floor = req.query.floor as string || '2'; // Default to floor 2
        
        // Validate request body
        if (!Array.isArray(nodes)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid request: nodes must be an array' 
            });
        }
        
        // Validate each node structure
        for (let i = 0; i < nodes.length; i++) {
            if (!isValidNode(nodes[i])) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Invalid node structure at index ${i}` 
                });
            }
        }
        
        console.log(`Received ${nodes.length} nodes to save for floor ${floor}.`);

        const nodesPath = getFloorDataPath(floor, 'nodes.json');
        fs.writeFileSync(nodesPath, JSON.stringify(nodes, null, 2));

        res.json({ success: true, message: 'Nodes saved successfully' });
    } catch (error) {
        console.error('Error saving nodes:', error);
        res.status(500).json({ success: false, message: 'Failed to save nodes' });
    }
});

// Validation helper for wall segments
function isValidWall(wall: any): boolean {
    if (!Array.isArray(wall)) return false;
    
    // Each wall is an array of coordinate pairs [lat, lng]
    for (const point of wall) {
        if (!Array.isArray(point) || point.length !== 2) return false;
        if (typeof point[0] !== 'number' || typeof point[1] !== 'number') return false;
    }
    
    return true;
}

// Save walls endpoint (floor-aware)
app.post('/api/walls', (req, res) => {
    try {
        const walls = req.body;
        const floor = req.query.floor as string || '2'; // Default to floor 2
        
        // Validate request body
        if (!Array.isArray(walls)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid request: walls must be an array' 
            });
        }
        
        // Validate each wall structure
        for (let i = 0; i < walls.length; i++) {
            if (!isValidWall(walls[i])) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Invalid wall structure at index ${i}` 
                });
            }
        }
        
        console.log(`Received ${walls.length} walls to save for floor ${floor}.`);

        const wallsPath = getFloorDataPath(floor, 'walls.json');
        fs.writeFileSync(wallsPath, JSON.stringify(walls, null, 2));

        res.json({ success: true, message: 'Walls saved successfully' });
    } catch (error) {
        console.error('Error saving walls:', error);
        res.status(500).json({ success: false, message: 'Failed to save walls' });
    }
});

// Helper to get floor-specific data path
function getFloorDataPath(floor: string, filename: string): string {
    const floorDir = path.join(DATA_DIR, `floor${floor}`);
    return path.join(floorDir, filename);
}

// GET endpoints to load data (floor-aware)
app.get('/api/nodes', (req, res) => {
    try {
        const floor = req.query.floor as string || '2'; // Default to floor 2
        const nodesPath = getFloorDataPath(floor, 'nodes.json');
        
        if (fs.existsSync(nodesPath)) {
            const nodes = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));
            res.json(nodes);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Error loading nodes:', error);
        res.status(500).json({ error: 'Failed to load nodes' });
    }
});

// GET walls (used for pathfinding and display, floor-aware)
app.get('/api/walls', (req, res) => {
    try {
        const floor = req.query.floor as string || '2'; // Default to floor 2
        const wallsPath = getFloorDataPath(floor, 'walls.json');
        
        if (fs.existsSync(wallsPath)) {
            const walls = JSON.parse(fs.readFileSync(wallsPath, 'utf8'));
            res.json(walls);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Error loading walls:', error);
        res.status(500).json({ error: 'Failed to load walls' });
    }
});

// GET original walls endpoint (kept for reference, floor-aware)
app.get('/api/walls/original', (req, res) => {
    try {
        const floor = req.query.floor as string || '2';
        const wallsPath = getFloorDataPath(floor, 'walls.json');
        
        if (fs.existsSync(wallsPath)) {
            const walls = JSON.parse(fs.readFileSync(wallsPath, 'utf8'));
            res.json(walls);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Error loading original walls:', error);
        res.status(500).json({ error: 'Failed to load original walls' });
    }
});

// GET optimized walls endpoint (for testing - currently too aggressive, floor-aware)
app.get('/api/walls/optimized', (req, res) => {
    try {
        const floor = req.query.floor as string || '2';
        const optimizedPath = getFloorDataPath(floor, 'walls_optimized.json');
        
        if (fs.existsSync(optimizedPath)) {
            const walls = JSON.parse(fs.readFileSync(optimizedPath, 'utf8'));
            res.json(walls);
        } else {
            res.status(404).json({ error: 'Optimized walls not found' });
        }
    } catch (error) {
        console.error('Error loading optimized walls:', error);
        res.status(500).json({ error: 'Failed to load optimized walls' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
