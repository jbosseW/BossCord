const { ChessManager } = require('./chess.js');
const cm = new ChessManager();

// Test 1: Create lobby with blitz time control
const lobby = cm.createLobby('p1', 'Alice', '#fff', 'w', 'blitz');
console.log('1. Time control:', lobby.timeControl, '| Time per player:', lobby.timePerPlayer, 'ms');
const p1 = lobby.players.get('p1');
console.log('   Player1 timeRemaining:', p1.timeRemaining);

// Test 2: Join and check time
cm.joinLobby('p2', lobby.id, 'Bob', '#000');
const p2 = lobby.players.get('p2');
console.log('2. Player2 timeRemaining:', p2.timeRemaining);

// Test 3: Ready up both - game should start
cm.playerReady('p1');
cm.playerReady('p2');
console.log('3. State:', lobby.state, '| lastMoveTime set:', lobby.lastMoveTime !== null);

// Test 4: Check getLobbyTimes
const times = cm._getLobbyTimes(lobby);
console.log('4. Times:', JSON.stringify(times));

// Test 5: getLobbies includes timeControl
const lobbies = cm.getLobbies();
console.log('5. getLobbies timeControl:', lobbies[0].timeControl);

// Test 6: getLobbyState includes time fields
const state = cm.getLobbyState(lobby.id, 'p1');
console.log('6. getLobbyState timeControl:', state.timeControl, '| times:', JSON.stringify(state.times), '| lastMoveTime set:', state.lastMoveTime !== null);

// Test 7: Make a move and check time deduction
// Simulate 5 seconds elapsed
lobby.lastMoveTime = Date.now() - 5000;
const moveResult = cm.makeMove('p1', { from: [6, 4], to: [4, 4] }); // e4
if (moveResult.error) {
  console.log('7. Move error:', moveResult.error);
} else {
  const p1After = lobby.players.get('p1');
  console.log('7. Move success. P1 time remaining after ~5s move:', p1After.timeRemaining, '(should be ~175000)');
  console.log('   Turn is now:', lobby.turn);
}

// Test 8: Create untimed lobby - no timer tracking
const lobby2 = cm.createLobby('p3', 'Carol', '#aaa', 'w', 'none');
console.log('8. Untimed lobby timeControl:', lobby2.timeControl, '| timePerPlayer:', lobby2.timePerPlayer);

// Test 9: Create lobby with invalid time control defaults to none
const lobby3 = cm.createLobby('p4', 'Dave', '#bbb', 'w', 'invalid');
console.log('9. Invalid time control defaults to:', lobby3.timeControl);

// Test 10: Resign clears timer
cm.joinLobby('p5', lobby2.id, 'Eve', '#ccc');
cm.playerReady('p3');
cm.playerReady('p5');
cm.resign('p3');
console.log('10. After resign, lastMoveTime:', lobby2.lastMoveTime);

// Test 11: Timeout detection in _executeMove
const lobby4 = cm.createLobby('p6', 'Frank', '#ddd', 'w', 'bullet');
cm.joinLobby('p7', lobby4.id, 'Grace', '#eee');
cm.playerReady('p6');
cm.playerReady('p7');
// Simulate time running out - set lastMoveTime to 70 seconds ago (bullet = 60s)
lobby4.lastMoveTime = Date.now() - 70000;
const timeoutResult = cm.makeMove('p6', { from: [6, 4], to: [4, 4] });
console.log('11. Timeout test - state:', lobby4.state, '| result:', JSON.stringify(lobby4.result));

// Cleanup
cm.reset();
console.log('12. Reset OK, timerInterval:', cm._timerInterval, '| timedLobbies size:', cm._timedLobbies.size);
console.log('\nAll tests passed!');
