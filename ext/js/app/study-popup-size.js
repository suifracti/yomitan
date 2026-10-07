/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2016-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * @param {{left: number, top: number, width: number, height: number}} rect
 * @param {number} requestedWidth
 * @param {number} requestedHeight
 * @param {{left: number, top: number, right: number, bottom: number}} viewport
 * @param {boolean} below
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function fitStudyPopup(rect, requestedWidth, requestedHeight, viewport, below) {
    const width = Math.min(Math.max(0, requestedWidth), Math.max(0, viewport.right - viewport.left));
    const height = Math.min(Math.max(0, requestedHeight), Math.max(0, viewport.bottom - viewport.top));
    const anchorTop = below ? rect.top : rect.top + rect.height - height;
    return {
        left: Math.max(viewport.left, Math.min(rect.left, viewport.right - width)),
        top: Math.max(viewport.top, Math.min(anchorTop, viewport.bottom - height)),
        width,
        height,
    };
}
