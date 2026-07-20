/** Favorites rendering and destination selection for the navigation panel. */

import { getFavorites, toggleFavorite } from '../utils/storage'
import type { Node } from '../utils/types'
import { state } from './map-state'

function createFavoriteItem(room: string, onSelect: () => void, onToggle: () => void): HTMLElement {
  const item = document.createElement('div')
  item.className = 'favorite-item'

  const selectButton = document.createElement('button')
  selectButton.className = 'favorite-select'
  selectButton.type = 'button'
  selectButton.setAttribute('aria-label', `Use ${room} as destination`)
  const roomText = document.createElement('span')
  roomText.textContent = room
  selectButton.appendChild(roomText)
  selectButton.addEventListener('click', onSelect)

  const starButton = document.createElement('button')
  starButton.className = 'favorite-star active'
  starButton.setAttribute('aria-label', 'Remove from favorites')
  starButton.textContent = '★'
  starButton.addEventListener('click', onToggle)

  item.appendChild(selectButton)
  item.appendChild(starButton)
  return item
}

/** Refresh the favorites list from local storage and the current navigation data. */
export function updateFavoritesUI(): void {
  const container = document.getElementById('favorites-container')
  const list = document.getElementById('favorites-list')
  if (!container || !list) return

  const favoriteUIDs = getFavorites()
  const favoriteNodes = state.allNodesAllFloors.filter((node: Node) =>
    favoriteUIDs.includes(node.uid)
  )
  if (favoriteNodes.length === 0) {
    container.style.display = 'none'
    list.textContent = ''
    return
  }

  container.style.display = 'block'
  list.textContent = ''
  for (const node of favoriteNodes) {
    const roomName = node.rooms.filter((room) => room !== 'waypoint').join(', ')
    list.appendChild(
      createFavoriteItem(
        roomName,
        () => {
          const endInput = document.getElementById('end-input') as HTMLInputElement | null
          if (!endInput) return
          endInput.value = roomName
          state.selectedEndNode = node
        },
        () => {
          toggleFavorite(node.uid)
          updateFavoritesUI()
        }
      )
    )
  }
}
