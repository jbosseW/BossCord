// chess.js — Complete chess game engine for BossCord
// Supports full standard chess: all piece moves, castling, en passant,
// promotion, check/checkmate/stalemate, draws, algebraic notation, AI opponent.

const crypto = require('crypto');

// Piece values for AI evaluation
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

// Piece-square tables (from white's perspective, index 0 = a8, index 63 = h1)
// For black, we mirror vertically.
const PST = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
  ],
};

const MAX_CHAT = 50;
const MAX_LOBBIES = 50;
const AI_SEARCH_DEPTH = 3;

// Time control presets (milliseconds per player)
const TIME_CONTROLS = {
  bullet: 60000,
  blitz: 180000,
  rapid: 600000,
  classical: 1800000,
  none: 0,
};

const VALID_TIME_CONTROLS = ['none', 'bullet', 'blitz', 'rapid', 'classical'];
const TIMER_TICK_INTERVAL = 1000; // 1 second

// Column letters for notation
const COL_LETTERS = 'abcdefgh';

// ---------------------------------------------------------------------------
// Board utilities
// ---------------------------------------------------------------------------

function createStartingBoard() {
  // 8x8 board: board[row][col], row 0 = rank 8 (top), row 7 = rank 1 (bottom)
  // White starts on rows 6-7, Black starts on rows 0-1
  const board = [];
  for (let r = 0; r < 8; r++) {
    board[r] = [];
    for (let c = 0; c < 8; c++) {
      board[r][c] = null;
    }
  }
  // Black pieces (top)
  const backRow = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let c = 0; c < 8; c++) {
    board[0][c] = { type: backRow[c], color: 'b' };
    board[1][c] = { type: 'p', color: 'b' };
  }
  // White pieces (bottom)
  for (let c = 0; c < 8; c++) {
    board[6][c] = { type: 'p', color: 'w' };
    board[7][c] = { type: backRow[c], color: 'w' };
  }
  return board;
}

function cloneBoard(board) {
  const nb = [];
  for (let r = 0; r < 8; r++) {
    nb[r] = [];
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      nb[r][c] = p ? { type: p.type, color: p.color } : null;
    }
  }
  return nb;
}

function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function findKing(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'k' && p.color === color) return [r, c];
    }
  }
  return null;
}

// Check if a square is attacked by the given color
function isAttackedBy(board, row, col, byColor) {
  // Pawn attacks
  const pawnDir = byColor === 'w' ? 1 : -1; // pawns attack from this direction
  const pawnRow = row + pawnDir;
  if (inBounds(pawnRow, col - 1)) {
    const p = board[pawnRow][col - 1];
    if (p && p.type === 'p' && p.color === byColor) return true;
  }
  if (inBounds(pawnRow, col + 1)) {
    const p = board[pawnRow][col + 1];
    if (p && p.type === 'p' && p.color === byColor) return true;
  }

  // Knight attacks
  const knightMoves = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  for (let i = 0; i < knightMoves.length; i++) {
    const nr = row + knightMoves[i][0];
    const nc = col + knightMoves[i][1];
    if (inBounds(nr, nc)) {
      const p = board[nr][nc];
      if (p && p.type === 'n' && p.color === byColor) return true;
    }
  }

  // King attacks (for adjacent squares)
  const kingMoves = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  for (let i = 0; i < kingMoves.length; i++) {
    const nr = row + kingMoves[i][0];
    const nc = col + kingMoves[i][1];
    if (inBounds(nr, nc)) {
      const p = board[nr][nc];
      if (p && p.type === 'k' && p.color === byColor) return true;
    }
  }

  // Sliding pieces: rook/queen along straights, bishop/queen along diagonals
  const straightDirs = [[-1,0],[1,0],[0,-1],[0,1]];
  for (let d = 0; d < straightDirs.length; d++) {
    const dr = straightDirs[d][0];
    const dc = straightDirs[d][1];
    let nr = row + dr;
    let nc = col + dc;
    while (inBounds(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (p.color === byColor && (p.type === 'r' || p.type === 'q')) return true;
        break;
      }
      nr += dr;
      nc += dc;
    }
  }

  const diagDirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
  for (let d = 0; d < diagDirs.length; d++) {
    const dr = diagDirs[d][0];
    const dc = diagDirs[d][1];
    let nr = row + dr;
    let nc = col + dc;
    while (inBounds(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (p.color === byColor && (p.type === 'b' || p.type === 'q')) return true;
        break;
      }
      nr += dr;
      nc += dc;
    }
  }

  return false;
}

function isInCheck(board, color) {
  const kingPos = findKing(board, color);
  if (!kingPos) return false;
  const enemy = color === 'w' ? 'b' : 'w';
  return isAttackedBy(board, kingPos[0], kingPos[1], enemy);
}

// ---------------------------------------------------------------------------
// Move generation (pseudo-legal, then filtered for legality)
// ---------------------------------------------------------------------------

// Generate all pseudo-legal moves for a color (does NOT check if move leaves own king in check)
function generatePseudoLegalMoves(board, color, castlingRights, enPassantTarget) {
  const moves = [];
  const forward = color === 'w' ? -1 : 1;
  const startRow = color === 'w' ? 6 : 1;
  const promoRow = color === 'w' ? 0 : 7;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;

      if (piece.type === 'p') {
        // Forward one
        const r1 = r + forward;
        if (inBounds(r1, c) && !board[r1][c]) {
          if (r1 === promoRow) {
            moves.push({ from: [r, c], to: [r1, c], promotion: 'q' });
            moves.push({ from: [r, c], to: [r1, c], promotion: 'r' });
            moves.push({ from: [r, c], to: [r1, c], promotion: 'b' });
            moves.push({ from: [r, c], to: [r1, c], promotion: 'n' });
          } else {
            moves.push({ from: [r, c], to: [r1, c] });
          }
          // Forward two from start
          const r2 = r + forward * 2;
          if (r === startRow && inBounds(r2, c) && !board[r2][c]) {
            moves.push({ from: [r, c], to: [r2, c] });
          }
        }
        // Diagonal captures
        for (let dc = -1; dc <= 1; dc += 2) {
          const nc = c + dc;
          if (!inBounds(r1, nc)) continue;
          const target = board[r1][nc];
          if (target && target.color !== color) {
            if (r1 === promoRow) {
              moves.push({ from: [r, c], to: [r1, nc], promotion: 'q' });
              moves.push({ from: [r, c], to: [r1, nc], promotion: 'r' });
              moves.push({ from: [r, c], to: [r1, nc], promotion: 'b' });
              moves.push({ from: [r, c], to: [r1, nc], promotion: 'n' });
            } else {
              moves.push({ from: [r, c], to: [r1, nc] });
            }
          }
          // En passant
          if (enPassantTarget && enPassantTarget[0] === r1 && enPassantTarget[1] === nc) {
            moves.push({ from: [r, c], to: [r1, nc], enPassant: true });
          }
        }
      } else if (piece.type === 'n') {
        const knightMoves = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
        for (let i = 0; i < knightMoves.length; i++) {
          const nr = r + knightMoves[i][0];
          const nc = c + knightMoves[i][1];
          if (!inBounds(nr, nc)) continue;
          const target = board[nr][nc];
          if (!target || target.color !== color) {
            moves.push({ from: [r, c], to: [nr, nc] });
          }
        }
      } else if (piece.type === 'k') {
        const kingMoves = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
        for (let i = 0; i < kingMoves.length; i++) {
          const nr = r + kingMoves[i][0];
          const nc = c + kingMoves[i][1];
          if (!inBounds(nr, nc)) continue;
          const target = board[nr][nc];
          if (!target || target.color !== color) {
            moves.push({ from: [r, c], to: [nr, nc] });
          }
        }
        // Castling
        const enemy = color === 'w' ? 'b' : 'w';
        const kRow = color === 'w' ? 7 : 0;
        if (r === kRow && c === 4) {
          // Kingside: king to g-file (col 6), rook from h-file (col 7) to f-file (col 5)
          const kSideKey = color === 'w' ? 'wK' : 'bK';
          if (castlingRights[kSideKey]) {
            if (!board[kRow][5] && !board[kRow][6]) {
              const rook = board[kRow][7];
              if (rook && rook.type === 'r' && rook.color === color) {
                // King must not be in check and must not pass through check
                if (!isAttackedBy(board, kRow, 4, enemy) &&
                    !isAttackedBy(board, kRow, 5, enemy) &&
                    !isAttackedBy(board, kRow, 6, enemy)) {
                  moves.push({ from: [kRow, 4], to: [kRow, 6], castling: 'K' });
                }
              }
            }
          }
          // Queenside: king to c-file (col 2), rook from a-file (col 0) to d-file (col 3)
          const qSideKey = color === 'w' ? 'wQ' : 'bQ';
          if (castlingRights[qSideKey]) {
            if (!board[kRow][1] && !board[kRow][2] && !board[kRow][3]) {
              const rook = board[kRow][0];
              if (rook && rook.type === 'r' && rook.color === color) {
                if (!isAttackedBy(board, kRow, 4, enemy) &&
                    !isAttackedBy(board, kRow, 3, enemy) &&
                    !isAttackedBy(board, kRow, 2, enemy)) {
                  moves.push({ from: [kRow, 4], to: [kRow, 2], castling: 'Q' });
                }
              }
            }
          }
        }
      } else {
        // Sliding pieces: r, b, q
        let dirs = [];
        if (piece.type === 'r' || piece.type === 'q') {
          dirs = dirs.concat([[-1,0],[1,0],[0,-1],[0,1]]);
        }
        if (piece.type === 'b' || piece.type === 'q') {
          dirs = dirs.concat([[-1,-1],[-1,1],[1,-1],[1,1]]);
        }
        for (let d = 0; d < dirs.length; d++) {
          let nr = r + dirs[d][0];
          let nc = c + dirs[d][1];
          while (inBounds(nr, nc)) {
            const target = board[nr][nc];
            if (!target) {
              moves.push({ from: [r, c], to: [nr, nc] });
            } else {
              if (target.color !== color) {
                moves.push({ from: [r, c], to: [nr, nc] });
              }
              break;
            }
            nr += dirs[d][0];
            nc += dirs[d][1];
          }
        }
      }
    }
  }
  return moves;
}

// Apply a move to a cloned board and return the new board state
function applyMove(board, move) {
  const nb = cloneBoard(board);
  const piece = nb[move.from[0]][move.from[1]];
  if (!piece) return nb;

  // Move the piece
  nb[move.to[0]][move.to[1]] = piece;
  nb[move.from[0]][move.from[1]] = null;

  // En passant capture
  if (move.enPassant) {
    // The captured pawn is on the same row as the moving pawn, same column as target
    nb[move.from[0]][move.to[1]] = null;
  }

  // Promotion
  if (move.promotion) {
    nb[move.to[0]][move.to[1]] = { type: move.promotion, color: piece.color };
  }

  // Castling: move the rook
  if (move.castling) {
    const row = move.from[0];
    if (move.castling === 'K') {
      nb[row][5] = nb[row][7];
      nb[row][7] = null;
    } else {
      nb[row][3] = nb[row][0];
      nb[row][0] = null;
    }
  }

  return nb;
}

// Generate all legal moves for a color
function generateLegalMoves(board, color, castlingRights, enPassantTarget) {
  const pseudo = generatePseudoLegalMoves(board, color, castlingRights, enPassantTarget);
  const legal = [];
  for (let i = 0; i < pseudo.length; i++) {
    const move = pseudo[i];
    const newBoard = applyMove(board, move);
    if (!isInCheck(newBoard, color)) {
      legal.push(move);
    }
  }
  return legal;
}

// ---------------------------------------------------------------------------
// Algebraic notation
// ---------------------------------------------------------------------------
function squareName(row, col) {
  return COL_LETTERS[col] + (8 - row);
}

function pieceSymbol(type) {
  if (type === 'p') return '';
  return type.toUpperCase();
}

function generateNotation(board, move, legalMoves, resultBoard) {
  const piece = board[move.from[0]][move.from[1]];
  if (!piece) return '??';

  // Castling
  if (move.castling === 'K') {
    let notation = 'O-O';
    const enemy = piece.color === 'w' ? 'b' : 'w';
    if (isInCheck(resultBoard, enemy)) {
      if (generateLegalMoves(resultBoard, enemy,
          { wK: false, wQ: false, bK: false, bQ: false }, null).length === 0) {
        notation += '#';
      } else {
        notation += '+';
      }
    }
    return notation;
  }
  if (move.castling === 'Q') {
    let notation = 'O-O-O';
    const enemy = piece.color === 'w' ? 'b' : 'w';
    if (isInCheck(resultBoard, enemy)) {
      if (generateLegalMoves(resultBoard, enemy,
          { wK: false, wQ: false, bK: false, bQ: false }, null).length === 0) {
        notation += '#';
      } else {
        notation += '+';
      }
    }
    return notation;
  }

  let notation = '';
  const isCapture = board[move.to[0]][move.to[1]] !== null || move.enPassant;

  if (piece.type === 'p') {
    // Pawn moves
    if (isCapture) {
      notation = COL_LETTERS[move.from[1]] + 'x' + squareName(move.to[0], move.to[1]);
    } else {
      notation = squareName(move.to[0], move.to[1]);
    }
    if (move.promotion) {
      notation += '=' + move.promotion.toUpperCase();
    }
  } else {
    notation = pieceSymbol(piece.type);

    // Disambiguation: check if other pieces of same type can reach same target
    const ambiguous = [];
    for (let i = 0; i < legalMoves.length; i++) {
      const other = legalMoves[i];
      if (other === move) continue;
      if (other.to[0] !== move.to[0] || other.to[1] !== move.to[1]) continue;
      const otherPiece = board[other.from[0]][other.from[1]];
      if (otherPiece && otherPiece.type === piece.type && otherPiece.color === piece.color) {
        ambiguous.push(other);
      }
    }

    if (ambiguous.length > 0) {
      const sameCol = ambiguous.some(m => m.from[1] === move.from[1]);
      const sameRow = ambiguous.some(m => m.from[0] === move.from[0]);
      if (!sameCol) {
        notation += COL_LETTERS[move.from[1]];
      } else if (!sameRow) {
        notation += (8 - move.from[0]);
      } else {
        notation += COL_LETTERS[move.from[1]] + (8 - move.from[0]);
      }
    }

    if (isCapture) notation += 'x';
    notation += squareName(move.to[0], move.to[1]);
  }

  // Check/checkmate
  const enemy = piece.color === 'w' ? 'b' : 'w';
  if (isInCheck(resultBoard, enemy)) {
    // We need to check if it's checkmate - generate legal moves for enemy
    // Use minimal castling rights for this check (the actual rights don't matter for check detection)
    const enemyMoves = generateLegalMoves(resultBoard, enemy,
      { wK: false, wQ: false, bK: false, bQ: false }, null);
    if (enemyMoves.length === 0) {
      notation += '#';
    } else {
      notation += '+';
    }
  }

  return notation;
}

// ---------------------------------------------------------------------------
// Draw detection: insufficient material
// ---------------------------------------------------------------------------
function isInsufficientMaterial(board) {
  const pieces = { w: [], b: [] };
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) pieces[p.color].push({ type: p.type, row: r, col: c });
    }
  }

  const wCount = pieces.w.length;
  const bCount = pieces.b.length;

  // K vs K
  if (wCount === 1 && bCount === 1) return true;

  // K+B vs K or K+N vs K
  if (wCount === 1 && bCount === 2) {
    const nonKing = pieces.b.find(p => p.type !== 'k');
    if (nonKing && (nonKing.type === 'b' || nonKing.type === 'n')) return true;
  }
  if (bCount === 1 && wCount === 2) {
    const nonKing = pieces.w.find(p => p.type !== 'k');
    if (nonKing && (nonKing.type === 'b' || nonKing.type === 'n')) return true;
  }

  // K+B vs K+B with same-color bishops
  if (wCount === 2 && bCount === 2) {
    const wBishop = pieces.w.find(p => p.type === 'b');
    const bBishop = pieces.b.find(p => p.type === 'b');
    if (wBishop && bBishop) {
      const wBishopColor = (wBishop.row + wBishop.col) % 2;
      const bBishopColor = (bBishop.row + bBishop.col) % 2;
      if (wBishopColor === bBishopColor) return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Board serialization for client
// ---------------------------------------------------------------------------
function serializeBoard(board) {
  const result = [];
  for (let r = 0; r < 8; r++) {
    result[r] = [];
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      result[r][c] = p ? { type: p.type, color: p.color } : null;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// AI: Minimax with alpha-beta pruning
// ---------------------------------------------------------------------------
function evaluateBoard(board, color) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const val = PIECE_VALUES[p.type] || 0;
      // PST index: for white use as-is (row*8+col), for black mirror row
      const pstIdx = p.color === 'w' ? (r * 8 + c) : ((7 - r) * 8 + c);
      const pstVal = PST[p.type] ? PST[p.type][pstIdx] : 0;
      if (p.color === color) {
        score += val + pstVal;
      } else {
        score -= val + pstVal;
      }
    }
  }
  return score;
}

function minimax(board, depth, alpha, beta, maximizing, color, castlingRights, enPassantTarget) {
  const currentColor = maximizing ? color : (color === 'w' ? 'b' : 'w');
  const moves = generateLegalMoves(board, currentColor, castlingRights, enPassantTarget);

  if (depth === 0 || moves.length === 0) {
    if (moves.length === 0) {
      if (isInCheck(board, currentColor)) {
        // Checkmate: very bad for the current player
        return maximizing ? -100000 + (AI_SEARCH_DEPTH - depth) : 100000 - (AI_SEARCH_DEPTH - depth);
      }
      return 0; // Stalemate
    }
    return evaluateBoard(board, color);
  }

  if (maximizing) {
    let maxEval = -Infinity;
    for (let i = 0; i < moves.length; i++) {
      const newBoard = applyMove(board, moves[i]);
      const newCastling = updateCastlingRights(castlingRights, board, moves[i]);
      const newEp = getEnPassantTarget(board, moves[i]);
      const ev = minimax(newBoard, depth - 1, alpha, beta, false, color, newCastling, newEp);
      if (ev > maxEval) maxEval = ev;
      if (ev > alpha) alpha = ev;
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (let i = 0; i < moves.length; i++) {
      const newBoard = applyMove(board, moves[i]);
      const newCastling = updateCastlingRights(castlingRights, board, moves[i]);
      const newEp = getEnPassantTarget(board, moves[i]);
      const ev = minimax(newBoard, depth - 1, alpha, beta, true, color, newCastling, newEp);
      if (ev < minEval) minEval = ev;
      if (ev < beta) beta = ev;
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function updateCastlingRights(rights, board, move) {
  const newRights = { wK: rights.wK, wQ: rights.wQ, bK: rights.bK, bQ: rights.bQ };
  const piece = board[move.from[0]][move.from[1]];
  if (!piece) return newRights;

  // King move removes both castling rights
  if (piece.type === 'k') {
    if (piece.color === 'w') { newRights.wK = false; newRights.wQ = false; }
    else { newRights.bK = false; newRights.bQ = false; }
  }

  // Rook move or rook captured
  if (piece.type === 'r') {
    if (piece.color === 'w') {
      if (move.from[0] === 7 && move.from[1] === 7) newRights.wK = false;
      if (move.from[0] === 7 && move.from[1] === 0) newRights.wQ = false;
    } else {
      if (move.from[0] === 0 && move.from[1] === 7) newRights.bK = false;
      if (move.from[0] === 0 && move.from[1] === 0) newRights.bQ = false;
    }
  }

  // Capture on rook starting square
  if (move.to[0] === 7 && move.to[1] === 7) newRights.wK = false;
  if (move.to[0] === 7 && move.to[1] === 0) newRights.wQ = false;
  if (move.to[0] === 0 && move.to[1] === 7) newRights.bK = false;
  if (move.to[0] === 0 && move.to[1] === 0) newRights.bQ = false;

  return newRights;
}

function getEnPassantTarget(board, move) {
  const piece = board[move.from[0]][move.from[1]];
  if (!piece || piece.type !== 'p') return null;
  const rowDiff = move.to[0] - move.from[0];
  if (Math.abs(rowDiff) === 2) {
    // Pawn moved two squares: en passant target is the square it passed through
    return [(move.from[0] + move.to[0]) / 2, move.to[1]];
  }
  return null;
}

function findBestMove(board, color, castlingRights, enPassantTarget) {
  const moves = generateLegalMoves(board, color, castlingRights, enPassantTarget);
  if (moves.length === 0) return null;

  let bestMove = null;
  let bestScore = -Infinity;

  // Shuffle moves for variety when multiple moves have equal score
  for (let i = moves.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = moves[i];
    moves[i] = moves[j];
    moves[j] = tmp;
  }

  for (let i = 0; i < moves.length; i++) {
    const newBoard = applyMove(board, moves[i]);
    const newCastling = updateCastlingRights(castlingRights, board, moves[i]);
    const newEp = getEnPassantTarget(board, moves[i]);
    const score = minimax(newBoard, AI_SEARCH_DEPTH - 1, -Infinity, Infinity, false, color, newCastling, newEp);
    if (score > bestScore) {
      bestScore = score;
      bestMove = moves[i];
    }
  }

  return bestMove;
}

// ---------------------------------------------------------------------------
// ChessManager
// ---------------------------------------------------------------------------
class ChessManager {
  constructor() {
    this.lobbies = new Map();        // lobbyId -> lobby
    this.playerLobby = new Map();    // socketId -> lobbyId
    this.spectatorLobby = new Map(); // socketId -> lobbyId
    this.nextId = 1;
    this._aiTimers = new Map();      // lobbyId -> setTimeout handle
    this._broadcastFn = null;        // set by handler for AI moves
    this._timerInterval = null;      // setInterval handle for timed games
    this._timedLobbies = new Set();  // lobbyIds with active timed games
  }

  setBroadcastFn(fn) {
    this._broadcastFn = fn;
  }

  createLobby(socketId, name, color, preferredSide, timeControl) {
    if (this.playerLobby.has(socketId)) return null;
    if (this.lobbies.size >= MAX_LOBBIES) return null;

    const id = 'chess_' + (this.nextId++);
    const side = (preferredSide === 'b') ? 'b' : 'w';

    // Validate and normalize time control
    const tc = (timeControl && VALID_TIME_CONTROLS.indexOf(timeControl) !== -1) ? timeControl : 'none';
    const timePerPlayer = TIME_CONTROLS[tc] || 0;

    const lobby = {
      id: id,
      players: new Map(),
      spectators: new Map(),
      queue: [],               // array of { id, name, color } waiting to play winner
      state: 'waiting',
      board: null,
      turn: 'w',
      moveHistory: [],
      castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
      enPassantTarget: null,
      halfMoveClock: 0,
      fullMoveNumber: 1,
      inCheck: false,
      result: null,
      drawOffer: null,
      chat: [],
      createdAt: Date.now(),
      timeControl: tc,
      timePerPlayer: timePerPlayer,
      lastMoveTime: null,
    };

    lobby.players.set(socketId, {
      id: socketId,
      name: name || 'Anon',
      color: color || '#5865f2',
      side: side,
      ready: false,
      isAI: false,
      timeRemaining: timePerPlayer,
    });

    this.lobbies.set(id, lobby);
    this.playerLobby.set(socketId, id);
    return lobby;
  }

  joinLobby(socketId, lobbyId, name, color) {
    if (this.playerLobby.has(socketId)) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.state !== 'waiting') return null;
    if (lobby.players.size >= 2) return null;

    // Determine side: opposite of existing player
    let takenSide = null;
    for (const [, p] of lobby.players) {
      if (!p.isAI) takenSide = p.side;
    }
    const side = takenSide === 'w' ? 'b' : 'w';

    // Remove any AI player when a human joins
    for (const [pid, p] of lobby.players) {
      if (p.isAI) {
        lobby.players.delete(pid);
        this.playerLobby.delete(pid);
        break;
      }
    }

    lobby.players.set(socketId, {
      id: socketId,
      name: name || 'Anon',
      color: color || '#5865f2',
      side: side,
      ready: false,
      isAI: false,
      timeRemaining: lobby.timePerPlayer,
    });

    this.playerLobby.set(socketId, lobbyId);
    return lobby;
  }

  leaveLobby(socketId) {
    const lobbyId = this.playerLobby.get(socketId);
    if (!lobbyId) return null;
    const lobby = this.lobbies.get(lobbyId);
    this.playerLobby.delete(socketId);
    if (!lobby) return { lobbyId: lobbyId, destroyed: true };

    lobby.players.delete(socketId);

    // Clear AI timer for this lobby
    this._clearAITimer(lobbyId);

    if (lobby.players.size === 0) {
      // Clean up spectators
      if (lobby.spectators) {
        for (const [sid] of lobby.spectators) {
          this.spectatorLobby.delete(sid);
        }
      }
      this.lobbies.delete(lobbyId);
      return { lobbyId: lobbyId, destroyed: true };
    }

    // If game was in progress, the remaining player wins by abandonment
    if (lobby.state === 'playing') {
      const remaining = lobby.players.values().next().value;
      if (remaining) {
        lobby.result = {
          winner: remaining.side,
          reason: 'abandon',
        };
        lobby.state = 'finished';
        lobby.lastMoveTime = null;
        this._removeTimedLobby(lobbyId);
      }
    }

    // Clean up queue entries for the leaving player
    if (lobby.queue) {
      lobby.queue = lobby.queue.filter(function(q) { return q.id !== socketId; });
    }

    return { lobbyId: lobbyId, destroyed: false };
  }

  spectate(socketId, lobbyId, name, color) {
    if (this.playerLobby.has(socketId)) return null;
    if (this.spectatorLobby.has(socketId)) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;
    if (lobby.spectators && lobby.spectators.size >= 50) return null; // Spectator limit
    lobby.spectators.set(socketId, { id: socketId, name: (name || 'Anon').slice(0, 20), color: color || '#dcddde' });
    this.spectatorLobby.set(socketId, lobbyId);
    return lobby;
  }

  leaveSpectator(socketId) {
    const lobbyId = this.spectatorLobby.get(socketId);
    if (!lobbyId) return null;
    this.spectatorLobby.delete(socketId);
    const lobby = this.lobbies.get(lobbyId);
    if (lobby) {
      lobby.spectators.delete(socketId);
      // Also remove from queue
      if (lobby.queue) {
        lobby.queue = lobby.queue.filter(function(q) { return q.id !== socketId; });
      }
    }
    return { lobbyId: lobbyId };
  }

  joinQueue(socketId, lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;
    // Must be a spectator to queue
    if (!this.spectatorLobby.has(socketId)) return null;
    // Don't queue if already in queue
    for (let i = 0; i < lobby.queue.length; i++) {
      if (lobby.queue[i].id === socketId) return null;
    }
    const spec = lobby.spectators.get(socketId);
    if (!spec) return null;
    lobby.queue.push({ id: socketId, name: spec.name, color: spec.color });
    return lobby;
  }

  leaveQueue(socketId) {
    const lobbyId = this.spectatorLobby.get(socketId);
    if (!lobbyId) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;
    lobby.queue = lobby.queue.filter(function(q) { return q.id !== socketId; });
    return lobby;
  }

  // After game finishes, promote next queued player to play the winner
  promoteFromQueue(lobby) {
    if (!lobby || !lobby.result || lobby.queue.length === 0) return null;

    // Find the winner
    let winnerId = null;
    for (const [pid, p] of lobby.players) {
      if (p.side === lobby.result.winner) { winnerId = pid; break; }
    }
    if (!winnerId) return null;
    const winner = lobby.players.get(winnerId);
    if (!winner) return null;

    // Get next queued player
    const next = lobby.queue.shift();
    if (!next) return null;

    // Remove the loser from players
    let loserId = null;
    for (const [pid] of lobby.players) {
      if (pid !== winnerId) { loserId = pid; break; }
    }
    if (loserId) {
      lobby.players.delete(loserId);
      this.playerLobby.delete(loserId);
      // Move loser to spectators
      const loser = lobby.players.get(loserId);
      lobby.spectators.set(loserId, { id: loserId, name: loser ? loser.name : 'Player', color: loser ? loser.color : '#dcddde' });
      this.spectatorLobby.set(loserId, lobby.id);
    }

    // Remove next from spectators
    lobby.spectators.delete(next.id);
    this.spectatorLobby.delete(next.id);

    // Assign sides: winner keeps their side, challenger gets opposite
    const winnerSide = winner.side;
    const challengerSide = winnerSide === 'w' ? 'b' : 'w';

    // Reset game state
    winner.ready = false;
    winner.timeRemaining = lobby.timePerPlayer;
    lobby.players.set(next.id, {
      id: next.id,
      name: next.name,
      color: next.color,
      side: challengerSide,
      ready: false,
      isAI: false,
      timeRemaining: lobby.timePerPlayer,
    });
    this.playerLobby.set(next.id, lobby.id);

    lobby.state = 'waiting';
    lobby.board = null;
    lobby.turn = 'w';
    lobby.moveHistory = [];
    lobby.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
    lobby.enPassantTarget = null;
    lobby.halfMoveClock = 0;
    lobby.fullMoveNumber = 1;
    lobby.inCheck = false;
    lobby.result = null;
    lobby.drawOffer = null;
    lobby.lastMoveTime = null;

    return { lobby: lobby, loserId: loserId, nextPlayerId: next.id };
  }

  getSpectatorLobbyId(socketId) {
    return this.spectatorLobby.get(socketId) || null;
  }

  playerReady(socketId) {
    const lobbyId = this.playerLobby.get(socketId);
    if (!lobbyId) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.state !== 'waiting') return null;
    const p = lobby.players.get(socketId);
    if (!p) return null;
    p.ready = true;

    // Check if both players are ready
    if (lobby.players.size === 2) {
      let allReady = true;
      for (const [, pl] of lobby.players) {
        if (!pl.ready) { allReady = false; break; }
      }
      if (allReady) {
        this._startGame(lobby);
      }
    }

    return lobby;
  }

  addAI(lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.state !== 'waiting') return null;
    if (lobby.players.size >= 2) return null;

    // Determine side for AI
    let humanSide = null;
    for (const [, p] of lobby.players) {
      if (!p.isAI) humanSide = p.side;
    }
    const aiSide = humanSide === 'w' ? 'b' : 'w';

    const aiId = 'chess_ai_' + lobbyId + '_' + Date.now();
    lobby.players.set(aiId, {
      id: aiId,
      name: 'Chess Bot',
      color: '#ed4245',
      side: aiSide,
      ready: true,
      isAI: true,
      timeRemaining: lobby.timePerPlayer,
    });
    this.playerLobby.set(aiId, lobbyId);

    // Auto-ready the human too and start
    for (const [, p] of lobby.players) {
      p.ready = true;
    }
    this._startGame(lobby);

    return lobby;
  }

  _startGame(lobby) {
    lobby.state = 'playing';
    lobby.board = createStartingBoard();
    lobby.turn = 'w';
    lobby.moveHistory = [];
    lobby.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
    lobby.enPassantTarget = null;
    lobby.halfMoveClock = 0;
    lobby.fullMoveNumber = 1;
    lobby.inCheck = false;
    lobby.result = null;
    lobby.drawOffer = null;

    // Reset time remaining for both players
    for (const [, p] of lobby.players) {
      p.timeRemaining = lobby.timePerPlayer;
    }

    // Start timer if timed game
    if (lobby.timeControl !== 'none' && lobby.timePerPlayer > 0) {
      lobby.lastMoveTime = Date.now();
      this._addTimedLobby(lobby.id);
    } else {
      lobby.lastMoveTime = null;
    }

    // If it's AI's turn (AI plays white), trigger AI move
    this._checkAITurn(lobby);
  }

  makeMove(socketId, move) {
    const lobbyId = this.playerLobby.get(socketId);
    if (!lobbyId) return { error: 'Not in a lobby' };
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.state !== 'playing') return { error: 'Game not in progress' };

    const player = lobby.players.get(socketId);
    if (!player) return { error: 'Not a player' };
    if (player.side !== lobby.turn) return { error: 'Not your turn' };

    return this._executeMove(lobby, move);
  }

  _executeMove(lobby, move) {
    if (!move || !move.from || !move.to) return { error: 'Invalid move format' };
    if (!Array.isArray(move.from) || !Array.isArray(move.to)) return { error: 'Invalid move format' };

    const fromR = move.from[0];
    const fromC = move.from[1];
    const toR = move.to[0];
    const toC = move.to[1];

    if (!inBounds(fromR, fromC) || !inBounds(toR, toC)) return { error: 'Out of bounds' };

    const piece = lobby.board[fromR][fromC];
    if (!piece || piece.color !== lobby.turn) return { error: 'No valid piece at source' };

    // Deduct time for the moving player if timed game
    if (lobby.timeControl !== 'none' && lobby.lastMoveTime !== null) {
      const now = Date.now();
      const elapsed = now - lobby.lastMoveTime;
      const movingPlayer = this._getPlayerBySide(lobby, lobby.turn);
      if (movingPlayer) {
        movingPlayer.timeRemaining -= elapsed;
        if (movingPlayer.timeRemaining <= 0) {
          movingPlayer.timeRemaining = 0;
          const winnerSide = lobby.turn === 'w' ? 'b' : 'w';
          lobby.result = { winner: winnerSide, reason: 'timeout' };
          lobby.state = 'finished';
          lobby.lastMoveTime = null;
          this._removeTimedLobby(lobby.id);
          this._clearAITimer(lobby.id);
          return { success: true, lobby: lobby };
        }
      }
      // Update lastMoveTime for the next player's clock
      lobby.lastMoveTime = now;
    }

    // Generate legal moves and find a match
    const legalMoves = generateLegalMoves(lobby.board, lobby.turn, lobby.castlingRights, lobby.enPassantTarget);

    let matchedMove = null;
    for (let i = 0; i < legalMoves.length; i++) {
      const lm = legalMoves[i];
      if (lm.from[0] === fromR && lm.from[1] === fromC &&
          lm.to[0] === toR && lm.to[1] === toC) {
        // For promotions, match the promotion piece if specified
        if (lm.promotion) {
          const requestedPromo = move.promotion || 'q';
          if (lm.promotion === requestedPromo) {
            matchedMove = lm;
            break;
          }
        } else {
          matchedMove = lm;
          break;
        }
      }
    }

    if (!matchedMove) return { error: 'Illegal move' };

    // Capture detection (for half-move clock)
    const captured = lobby.board[toR][toC];
    const isPawnMove = piece.type === 'p';
    const isCapture = captured !== null || matchedMove.enPassant;

    // Apply the move
    const newBoard = applyMove(lobby.board, matchedMove);

    // Generate notation before updating state
    const notation = generateNotation(lobby.board, matchedMove, legalMoves, newBoard);

    // Update castling rights
    lobby.castlingRights = updateCastlingRights(lobby.castlingRights, lobby.board, matchedMove);

    // Update en passant target
    lobby.enPassantTarget = getEnPassantTarget(lobby.board, matchedMove);

    // Update half-move clock (reset on pawn move or capture)
    if (isPawnMove || isCapture) {
      lobby.halfMoveClock = 0;
    } else {
      lobby.halfMoveClock++;
    }

    // Update full move number (increments after black's move)
    if (lobby.turn === 'b') {
      lobby.fullMoveNumber++;
    }

    // Commit board
    lobby.board = newBoard;

    // Record move in history
    lobby.moveHistory.push({
      from: [fromR, fromC],
      to: [toR, toC],
      piece: piece.type,
      color: piece.color,
      captured: captured ? captured.type : (matchedMove.enPassant ? 'p' : null),
      promotion: matchedMove.promotion || null,
      castling: matchedMove.castling || null,
      notation: notation,
    });

    // Switch turns
    const nextTurn = lobby.turn === 'w' ? 'b' : 'w';
    lobby.turn = nextTurn;

    // Clear draw offer on move
    lobby.drawOffer = null;

    // Check game state
    lobby.inCheck = isInCheck(lobby.board, nextTurn);
    const nextLegalMoves = generateLegalMoves(lobby.board, nextTurn, lobby.castlingRights, lobby.enPassantTarget);

    if (nextLegalMoves.length === 0) {
      if (lobby.inCheck) {
        // Checkmate
        lobby.result = {
          winner: piece.color,
          reason: 'checkmate',
        };
        lobby.state = 'finished';
      } else {
        // Stalemate
        lobby.result = {
          winner: 'draw',
          reason: 'stalemate',
        };
        lobby.state = 'finished';
      }
    } else if (isInsufficientMaterial(lobby.board)) {
      lobby.result = {
        winner: 'draw',
        reason: 'insufficient',
      };
      lobby.state = 'finished';
    } else if (lobby.halfMoveClock >= 100) {
      // 50-move rule (100 half-moves = 50 full moves)
      lobby.result = {
        winner: 'draw',
        reason: 'fifty_move',
      };
      lobby.state = 'finished';
    }

    // On game end, stop the clock and clean up timed lobby tracking
    if (lobby.state === 'finished') {
      lobby.lastMoveTime = null;
      this._removeTimedLobby(lobby.id);
    }

    // If game is still going, check if AI should move next
    if (lobby.state === 'playing') {
      this._checkAITurn(lobby);
    }

    return { success: true, lobby: lobby };
  }

  resign(socketId) {
    const lobbyId = this.playerLobby.get(socketId);
    if (!lobbyId) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.state !== 'playing') return null;

    const player = lobby.players.get(socketId);
    if (!player) return null;

    const winnerSide = player.side === 'w' ? 'b' : 'w';
    lobby.result = {
      winner: winnerSide,
      reason: 'resign',
    };
    lobby.state = 'finished';
    lobby.lastMoveTime = null;
    this._removeTimedLobby(lobbyId);
    this._clearAITimer(lobbyId);
    return lobby;
  }

  offerDraw(socketId) {
    const lobbyId = this.playerLobby.get(socketId);
    if (!lobbyId) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.state !== 'playing') return null;
    if (!lobby.players.has(socketId)) return null;

    lobby.drawOffer = socketId;
    return lobby;
  }

  acceptDraw(socketId) {
    const lobbyId = this.playerLobby.get(socketId);
    if (!lobbyId) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.state !== 'playing') return null;
    if (!lobby.drawOffer) return null;
    // Can't accept your own draw offer
    if (lobby.drawOffer === socketId) return null;

    lobby.result = {
      winner: 'draw',
      reason: 'agreement',
    };
    lobby.state = 'finished';
    lobby.lastMoveTime = null;
    this._removeTimedLobby(lobbyId);
    this._clearAITimer(lobbyId);
    return lobby;
  }

  addChat(socketId, message) {
    let lobbyId = this.playerLobby.get(socketId);
    if (!lobbyId) lobbyId = this.spectatorLobby.get(socketId);
    if (!lobbyId) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;
    let player = lobby.players.get(socketId);
    if (!player && lobby.spectators) player = lobby.spectators.get(socketId);
    if (!player) return null;

    const msg = {
      id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
      name: player.name,
      color: player.color,
      text: (typeof message === 'string' ? message : '').slice(0, 200),
      ts: Date.now(),
    };
    lobby.chat.push(msg);
    if (lobby.chat.length > MAX_CHAT) lobby.chat.shift();
    return { lobbyId: lobbyId, msg: msg };
  }

  // -----------------------------------------------------------------------
  // AI
  // -----------------------------------------------------------------------
  _checkAITurn(lobby) {
    if (lobby.state !== 'playing') return;

    // Find if the current turn belongs to an AI player
    let aiPlayer = null;
    for (const [, p] of lobby.players) {
      if (p.isAI && p.side === lobby.turn) {
        aiPlayer = p;
        break;
      }
    }
    if (!aiPlayer) return;

    // Schedule AI move with random delay
    const delay = 500 + Math.floor(Math.random() * 1000);
    const lobbyId = lobby.id;

    this._clearAITimer(lobbyId);

    const timer = setTimeout(() => {
      this._aiTimers.delete(lobbyId);
      this._makeAIMove(lobbyId);
    }, delay);
    this._aiTimers.set(lobbyId, timer);
  }

  _makeAIMove(lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.state !== 'playing') return;

    // Find AI player for current turn
    let aiPlayer = null;
    for (const [, p] of lobby.players) {
      if (p.isAI && p.side === lobby.turn) {
        aiPlayer = p;
        break;
      }
    }
    if (!aiPlayer) return;

    const bestMove = findBestMove(lobby.board, lobby.turn, lobby.castlingRights, lobby.enPassantTarget);
    if (!bestMove) return;

    const moveData = {
      from: bestMove.from,
      to: bestMove.to,
      promotion: bestMove.promotion || undefined,
    };

    const result = this._executeMove(lobby, moveData);
    if (result.success && this._broadcastFn) {
      this._broadcastFn(lobbyId, lobby);
    }
  }

  _clearAITimer(lobbyId) {
    const timer = this._aiTimers.get(lobbyId);
    if (timer) {
      clearTimeout(timer);
      this._aiTimers.delete(lobbyId);
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------
  getLobbies() {
    const out = [];
    for (const [, lobby] of this.lobbies) {
      const players = [];
      for (const [, p] of lobby.players) {
        players.push({ name: p.name, color: p.color, side: p.side, isAI: p.isAI });
      }
      out.push({
        id: lobby.id,
        playerCount: lobby.players.size,
        spectatorCount: lobby.spectators ? lobby.spectators.size : 0,
        queueCount: lobby.queue ? lobby.queue.length : 0,
        state: lobby.state,
        players: players,
        createdAt: lobby.createdAt,
        timeControl: lobby.timeControl || 'none',
      });
    }
    return out;
  }

  getLobbyState(lobbyId, forSocketId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;

    const players = [];
    for (const [pid, p] of lobby.players) {
      players.push({
        id: pid,
        name: p.name,
        color: p.color,
        side: p.side,
        ready: p.ready,
        isAI: p.isAI,
        isMe: pid === forSocketId,
      });
    }

    // Determine if forSocketId has a draw offer pending from opponent
    let drawOfferFrom = null;
    if (lobby.drawOffer) {
      const offerer = lobby.players.get(lobby.drawOffer);
      if (offerer) drawOfferFrom = offerer.name;
    }

    // Serialize spectators
    const spectators = [];
    if (lobby.spectators) {
      for (const [sid, s] of lobby.spectators) {
        spectators.push({ id: sid, name: s.name, color: s.color, isMe: sid === forSocketId });
      }
    }

    // Determine role and queue position
    let role = 'none';
    if (lobby.players.has(forSocketId)) role = 'player';
    else if (lobby.spectators && lobby.spectators.has(forSocketId)) role = 'spectator';
    let queuePosition = -1;
    if (lobby.queue) {
      for (let qi = 0; qi < lobby.queue.length; qi++) {
        if (lobby.queue[qi].id === forSocketId) { queuePosition = qi; break; }
      }
    }

    // Compute per-side time remaining
    const times = this._getLobbyTimes(lobby);

    return {
      id: lobby.id,
      state: lobby.state,
      board: lobby.board ? serializeBoard(lobby.board) : null,
      turn: lobby.turn,
      moveHistory: lobby.moveHistory,
      castlingRights: lobby.castlingRights,
      enPassantTarget: lobby.enPassantTarget,
      halfMoveClock: lobby.halfMoveClock,
      fullMoveNumber: lobby.fullMoveNumber,
      inCheck: lobby.inCheck,
      result: lobby.result,
      drawOffer: lobby.drawOffer,
      drawOfferFrom: drawOfferFrom,
      players: players,
      spectators: spectators,
      spectatorCount: spectators.length,
      queue: lobby.queue ? lobby.queue.map(function(q) { return { name: q.name, isMe: q.id === forSocketId }; }) : [],
      queuePosition: queuePosition,
      role: role,
      chat: lobby.chat,
      timeControl: lobby.timeControl || 'none',
      times: times,
      lastMoveTime: lobby.lastMoveTime,
    };
  }

  getPlayerLobbyId(socketId) {
    return this.playerLobby.get(socketId) || null;
  }

  // -----------------------------------------------------------------------
  // Timer system
  // -----------------------------------------------------------------------

  // Get the player object for a given side ('w' or 'b')
  _getPlayerBySide(lobby, side) {
    for (const [, p] of lobby.players) {
      if (p.side === side) return p;
    }
    return null;
  }

  // Compute current per-side time remaining, accounting for elapsed time on the active clock
  _getLobbyTimes(lobby) {
    if (!lobby.timeControl || lobby.timeControl === 'none' || lobby.timePerPlayer === 0) {
      return null;
    }

    const whitePlayer = this._getPlayerBySide(lobby, 'w');
    const blackPlayer = this._getPlayerBySide(lobby, 'b');
    let wTime = whitePlayer ? whitePlayer.timeRemaining : 0;
    let bTime = blackPlayer ? blackPlayer.timeRemaining : 0;

    // If the game is actively being played, subtract elapsed time from the current turn's player
    if (lobby.state === 'playing' && lobby.lastMoveTime !== null) {
      const elapsed = Date.now() - lobby.lastMoveTime;
      if (lobby.turn === 'w') {
        wTime = Math.max(0, wTime - elapsed);
      } else {
        bTime = Math.max(0, bTime - elapsed);
      }
    }

    return { w: Math.max(0, Math.round(wTime)), b: Math.max(0, Math.round(bTime)) };
  }

  // Add a lobby to the timed set and start the timer interval if needed
  _addTimedLobby(lobbyId) {
    this._timedLobbies.add(lobbyId);
    if (!this._timerInterval) {
      this._timerInterval = setInterval(() => {
        this._timerTick();
      }, TIMER_TICK_INTERVAL);
    }
  }

  // Remove a lobby from the timed set and stop the interval if no timed games remain
  _removeTimedLobby(lobbyId) {
    this._timedLobbies.delete(lobbyId);
    if (this._timedLobbies.size === 0 && this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  // Called every second: check all active timed lobbies for timeout and broadcast time updates
  _timerTick() {
    const now = Date.now();
    for (const lobbyId of this._timedLobbies) {
      const lobby = this.lobbies.get(lobbyId);
      if (!lobby || lobby.state !== 'playing' || lobby.lastMoveTime === null) {
        // Stale entry; clean up
        this._timedLobbies.delete(lobbyId);
        continue;
      }

      const elapsed = now - lobby.lastMoveTime;
      const currentPlayer = this._getPlayerBySide(lobby, lobby.turn);
      if (!currentPlayer) continue;

      const remaining = currentPlayer.timeRemaining - elapsed;

      if (remaining <= 0) {
        // Time has run out for the current turn's player
        currentPlayer.timeRemaining = 0;
        const winnerSide = lobby.turn === 'w' ? 'b' : 'w';
        lobby.result = { winner: winnerSide, reason: 'timeout' };
        lobby.state = 'finished';
        lobby.lastMoveTime = null;
        this._removeTimedLobby(lobbyId);
        this._clearAITimer(lobbyId);

        // Broadcast the final state and time update via the broadcastFn
        if (this._broadcastFn) {
          this._broadcastFn(lobbyId, lobby);
        }
      } else {
        // Broadcast time update
        const times = this._getLobbyTimes(lobby);
        if (times && this._broadcastFn) {
          this._broadcastFn(lobbyId, lobby, 'time_update', times);
        }
      }
    }
  }

  reset() {
    // Clear all AI timers
    for (const [, timer] of this._aiTimers) {
      clearTimeout(timer);
    }
    this._aiTimers.clear();
    // Clear timer interval
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
    this._timedLobbies.clear();
    this.lobbies.clear();
    this.playerLobby.clear();
    this.spectatorLobby.clear();
  }
}

module.exports = { ChessManager };
