/**
 * Graph construction for pathfinding
 * Builds visibility graphs where nodes are connected if they have line of sight
 */

import type { Node, Wall, Graph, Edge } from './types'
import { hasLineOfSight, distance } from './geometry'

/**
 * Build a visibility graph from nodes and walls
 * 
 * A visibility graph connects two nodes if:
 * - There is a direct line of sight between them (no walls blocking)
 * - They are within a maximum distance threshold (prevents long shortcuts)
 * - The edge weight is the Euclidean distance between nodes
 * 
 * @param nodes Array of navigation nodes
 * @param walls Array of wall segments
 * @param maxDistance Maximum distance for connections (default: 800 pixels, ~hallway length)
 * @returns Graph as an adjacency list (Map of node UID to edges)
 */
export function buildVisibilityGraph(
  nodes: Node[], 
  walls: Wall[],
  maxDistance: number = 800
): Graph {
  const graph: Graph = new Map()
  
  // Initialize empty adjacency list for each node
  nodes.forEach(node => {
    graph.set(node.uid, [])
  })
  
  console.log(`Building visibility graph for ${nodes.length} nodes and ${walls.length} walls...`)
  console.log(`Max connection distance: ${maxDistance} pixels`)
  
  // Check each pair of nodes
  let edgesAdded = 0
  let edgesSkippedDistance = 0
  let edgesSkippedWalls = 0
  
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const n1 = nodes[i]
      const n2 = nodes[j]
      
      const p1 = { lat: n1.lat, lng: n1.lng }
      const p2 = { lat: n2.lat, lng: n2.lng }
      
      const dist = distance(p1, p2)
      
      // Skip if too far apart (prevents long shortcuts)
      if (dist > maxDistance) {
        edgesSkippedDistance++
        continue
      }
      
      // Check if there's a clear line of sight
      if (hasLineOfSight(p1, p2, walls)) {
        // Add bidirectional edge
        graph.get(n1.uid)!.push({ to: n2.uid, cost: dist })
        graph.get(n2.uid)!.push({ to: n1.uid, cost: dist })
        
        edgesAdded++
      } else {
        edgesSkippedWalls++
      }
    }
  }
  
  console.log(`Visibility graph built:`)
  console.log(`  - ${edgesAdded} edges added`)
  console.log(`  - ${edgesSkippedDistance} skipped (too far)`)
  console.log(`  - ${edgesSkippedWalls} skipped (walls blocking)`)
  
  // Add stairway connections (cross-floor portals)
  addStairwayConnections(nodes, graph)
  
  // Log nodes with no connections (isolated)
  const isolated = Array.from(graph.entries())
    .filter(([_, edges]) => edges.length === 0)
    .map(([uid, _]) => uid)
  
  if (isolated.length > 0) {
    console.warn(`Warning: ${isolated.length} isolated nodes (no connections)`)
    isolated.forEach(uid => {
      const node = nodes.find(n => n.uid === uid)
      if (node) {
        console.warn(`  - ${node.rooms.join(', ')} at (${node.lat}, ${node.lng})`)
      }
    })
  }
  
  return graph
}

/**
 * Add cross-floor connections via stairways
 * Stairways act as "portals" between floors
 * 
 * Connections can be specified by either:
 * - UID (legacy support)
 * - Stairway name (user-friendly, recommended)
 * 
 * @param nodes Array of all nodes
 * @param graph Graph to add connections to
 */
function addStairwayConnections(nodes: Node[], graph: Graph): void {
  // Find all stairway nodes
  const stairways = nodes.filter(n => n.type === "stairway")
  
  if (stairways.length === 0) {
    console.log('No stairways found - single floor navigation only')
    return
  }
  
  console.log(`Adding stairway connections for ${stairways.length} stairways...`)
  console.log('Stairways:', stairways.map(s => ({ name: s.rooms[0], floor: s.floor, uid: s.uid, connectsTo: s.connectsTo })))
  
  let connectionsAdded = 0
  
  for (const stairway of stairways) {
    console.log(`Processing stairway: ${stairway.rooms[0]} (Floor ${stairway.floor})`)
    
    if (!stairway.connectsTo || stairway.connectsTo.length === 0) {
      console.log(`  -> No connections defined`)
      continue
    }
    
    console.log(`  -> Looking for connections: ${stairway.connectsTo}`)
    
    // Connect this stairway to each connected floor's stairway
    for (const targetIdentifier of stairway.connectsTo) {
      console.log(`  -> Searching for: "${targetIdentifier}"`)
      
      // Try to find target by UID first
      let targetNode = nodes.find(n => n.uid === targetIdentifier)
      
      if (targetNode) {
        console.log(`  -> Found by UID: ${targetNode.rooms[0]} (Floor ${targetNode.floor})`)
      }
      
      // If not found by UID, try to find by stairway name
      if (!targetNode) {
        console.log(`  -> Not found by UID, searching by name on different floors...`)
        targetNode = nodes.find(n => 
          n.type === "stairway" && 
          n.rooms.some(room => room === targetIdentifier) &&
          n.floor !== stairway.floor  // Must be on different floor
        )
        if (targetNode) {
          console.log(`  -> Found by name: ${targetNode.rooms[0]} (Floor ${targetNode.floor}, UID: ${targetNode.uid})`)
        }
      }
      
      if (!targetNode) {
        console.warn(`  -> ❌ Stairway connection not found: "${targetIdentifier}" (referenced by ${stairway.rooms[0]})`)
        continue
      }
      
      // Skip if trying to connect to itself
      if (targetNode.uid === stairway.uid) {
        console.warn(`  -> Stairway ${stairway.rooms[0]} trying to connect to itself - skipping`)
        continue
      }
      
      console.log(`  -> ✅ Creating connection between ${stairway.uid} and ${targetNode.uid}`)
      
      // Add bidirectional connection with small cost
      // Cost is small (50) to represent stairs are quick to use
      const stairCost = 50
      
      // From current floor to target floor
      if (!graph.has(stairway.uid)) {
        graph.set(stairway.uid, [])
      }
      graph.get(stairway.uid)!.push({
        to: targetNode.uid,
        cost: stairCost
      })
      
      // From target floor to current floor
      if (!graph.has(targetNode.uid)) {
        graph.set(targetNode.uid, [])
      }
      graph.get(targetNode.uid)!.push({
        to: stairway.uid,
        cost: stairCost
      })
      
      console.log(`  -> Connected: ${stairway.rooms[0]} (Floor ${stairway.floor}) ↔ ${targetNode.rooms[0]} (Floor ${targetNode.floor})`)
      connectionsAdded++
    }
  }
  
  if (connectionsAdded > 0) {
    console.log(`✅ Added ${connectionsAdded} stairway connections`)
  } else {
    console.warn('⚠️ No stairway connections were added!')
  }
}

/**
 * Get statistics about the graph
 */
export function getGraphStats(graph: Graph): {
  nodes: number
  edges: number
  avgDegree: number
  maxDegree: number
  minDegree: number
} {
  const nodes = graph.size
  let totalDegree = 0
  let maxDegree = 0
  let minDegree = Infinity
  
  for (const edges of graph.values()) {
    const degree = edges.length
    totalDegree += degree
    maxDegree = Math.max(maxDegree, degree)
    minDegree = Math.min(minDegree, degree)
  }
  
  return {
    nodes,
    edges: totalDegree / 2, // Divide by 2 because edges are bidirectional
    avgDegree: nodes > 0 ? totalDegree / nodes : 0,
    maxDegree,
    minDegree: minDegree === Infinity ? 0 : minDegree
  }
}
