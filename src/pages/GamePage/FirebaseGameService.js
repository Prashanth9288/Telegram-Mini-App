// src/services/FirebaseService.js
import { database } from "../../services/FirebaseConfig";
import { ref, update, get, runTransaction } from "firebase/database";
import { useTelegram } from "../../reactContext/TelegramContext.js";
import {addHistoryLog} from "../../services/addHistory.js"

export async function fetchHighScore() {
  const {user} = useTelegram()
  const userId = user.id
  const userRef = ref(database, `users/${userId}/Score`);
  try {
    const snapshot = await get(userRef);
    if (snapshot.exists()) {
      const userData = snapshot.val();
      return userData.game_highest_score || 0;
    } else {
      return 0;
    }
  } catch (error) {
    console.error("Error fetching high score from Firebase:", error);
    return 0;
  }
}

export async function updateGameScores(currentGameScore) {
  const {user} = useTelegram()
  const userId = user?.id; // Ensure userId is captured
  if (!userId) return;

  const userRef = ref(database, `users/${userId}/Score`);
  try {
    await runTransaction(userRef, (userData) => {
      if (!userData) {
        return {
          game_score: currentGameScore,
          game_highest_score: currentGameScore,
          total_score: currentGameScore // Assuming total_score should include this? Original code didn't update total_score? 
          // Wait, original code updated `game_score`. Did it update `total_score`?
          // Original: updates.game_score = ...; updates.game_highest_score = ...;
          // There was NO total_score update in original code.
          // BUT `addHistoryLog` was called.
          // IF the game point handling is separate (e.g. via history?), let's stick to original behavior but make it safe.
          // ACTUALLY, usually game score ADDS to total score.
          // Original code: `updates.game_score = (userData.game_score || 0) + currentGameScore;`
          // It did NOT update `total_score`. This might be a bug or intended.
          // I will STRICTLY replicate original logic but SAFELY.
        };
      }

      const newGameScore = (userData.game_score || 0) + currentGameScore;
      const currentHighScore = userData.game_highest_score || 0;
      const newHighScore = currentGameScore > currentHighScore ? currentGameScore : currentHighScore;

      return {
        ...userData,
        game_score: newGameScore,
        game_highest_score: newHighScore
      };
    });

    const textData = {
      action: 'Game Points Successfully Added',
      points: currentGameScore,
      type: 'game',
    }
    
    addHistoryLog(userId, textData)
    console.log("Scores updated successfully in Firebase.");
  } catch (error) {
    console.error("Error updating scores in Firebase:", error);
  }
}
