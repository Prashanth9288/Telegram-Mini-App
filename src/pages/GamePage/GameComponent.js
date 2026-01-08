// // src/App.js
// import React, { useState } from "react";
// import GameUI from "./GameUI";
// import Game from "./Game";
// import InstructionsPopup from "./InstructionsPopup";
// import GameOverPopup from "./GameOverPopup";
// import "../../Styles/gameComponent.css";

// function GameComponent() {
//   const [gameStarted, setGameStarted] = useState(false);
//   const [gameOver, setGameOver] = useState(false);
//   const [finalScore, setFinalScore] = useState(0);
//   const [highScore, setHighScore] = useState(0);
//   const [gameKey, setGameKey] = useState(0); // for remounting on restart

//   const handleStartGame = () => {
//     setGameStarted(true);
//     setGameOver(false);
//   };

//   const handleGameOver = (score, high) => {
//     setFinalScore(score);
//     setHighScore(high);
//     setGameOver(true);
//   };

//   const handleRestart = () => {
//     setGameKey(prev => prev + 1); // force remount
//     setGameOver(false);
//     // For try-again, you might automatically start the game,
//     // so no need to set gameStarted to false.
//   };

//   return (
//     <div id="app-container">
//       <GameUI />
//       <Game key={gameKey} startGame={gameStarted} onGameOver={handleGameOver} />
//       {!gameStarted && (
//         <InstructionsPopup show={true} onStart={handleStartGame} />
//       )}
//       <GameOverPopup
//         show={gameOver}
//         finalScore={finalScore}
//         highScore={highScore}
//         onRestart={handleRestart}
//       />

      
//     </div>
//   );
// }

// export default GameComponent;
import React, { useState } from "react";
import GameUI from "./GameUI";
import Game from "./Game";
import InstructionsPopup from "./InstructionsPopup";
import GameOverPopup from "./GameOverPopup";
import { useTelegram } from "../../reactContext/TelegramContext.js";
import { database } from "../../services/FirebaseConfig.js";
import { ref, get, update, runTransaction } from "firebase/database";

import "../../Styles/gameComponent.css";


function GameComponent() {
  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [gameKey, setGameKey] = useState(0); // used for remounting on restart
  const { user } = useTelegram();

  
  const decreaseTicketCount = async (userId) => {
    if (!userId) return;
  
    const scoreRef = ref(database, `users/${userId}/Score`);
  
    try {
      await runTransaction(scoreRef, (currentData) => {
        if (!currentData) return; // Should return undefined to abort or null/object to update? usually safely return undefined if no data
        // If data exists:
        const currentTickets = Number(currentData.no_of_tickets) || 0;
        if (currentTickets > 0) {
          return {
            ...currentData,
            no_of_tickets: currentTickets - 1
          };
        }
        return; // Abort if 0 tickets
      });
      console.log("Ticket count decreased safely.");
    } catch (error) {
      console.error("Error updating ticket count:", error);
    }
  }

  const handleStartGame = () => {
    setGameStarted(true);
    setGameOver(false);
    

    let userId = user.id
    decreaseTicketCount(userId)

  };

  const handleGameOver = (score, high) => {
    setFinalScore(score);
    setHighScore(high);
    setGameOver(true);

    // Mark game as played for today (Unlock Condition)
    const taskRef = ref(database, `connections/${user.id}/tasks/daily`);
    try {
      update(taskRef, { game: { lastPlayed: Date.now() } });
    } catch (error) {
       console.error("Error updating game task timestamp:", error);
    }
  };

  const handleRestart = () => {
    setGameKey((prev) => prev + 1); 
    setGameStarted(false);
    setGameOver(false);
  };

  // When the Back button is clicked, we set gameStarted to false.
  // That unmounts the Game component so its cleanup stops the music.
  const handleBack = () => {
    setGameStarted(false);
  };

  return (
    <div id="app-container">
      <GameUI />
      <Game key={gameKey} startGame={gameStarted} onGameOver={handleGameOver} />
      {!gameStarted && (
        <InstructionsPopup show={true} onStart={handleStartGame} onBack={handleBack} />
      )}
      <GameOverPopup
        show={gameOver}
        finalScore={finalScore}
        highScore={highScore}
        onRestart={handleRestart}
        onBack={handleBack}
      />

    </div>
    
  );
}

export default GameComponent;
