import { useState, useEffect } from "react";

import { get, update, ref, runTransaction, onValue } from "firebase/database";
import { database } from "../../services/FirebaseConfig"; 
import { useTelegram } from "../../reactContext/TelegramContext.js";
import {addHistoryLog} from "../../services/addHistory.js"
const FARMING_CONFIG = {
  duration: 43200, // Total farming time in seconds
  pointsPerSecond: 100 / 3600, // Points earned per second
};

const useFarming = () => {
  const { user } = useTelegram();
  const [farmingState, setFarmingState] = useState({
    isFarming: false,
    canClaim: false,
    remainingTime: FARMING_CONFIG.duration,
    pointsEarned: 0,
  });

  const farmingRef = ref(database, `connections/${user?.id}/farming`);

  useEffect(() => {
    if (!user?.id) return;

    // Real-time listener for farming state
    const unsubscribe = onValue(farmingRef, (snapshot) => {
      const data = snapshot.val();
      const now = Date.now();

      if (data && data.startTime) {
        // Farming is active or finished
        const elapsedSeconds = Math.floor((now - data.startTime) / 1000);
        
        if (elapsedSeconds >= FARMING_CONFIG.duration) {
          // Finished
           setFarmingState({
            isFarming: false,
            canClaim: true,
            remainingTime: 0,
            pointsEarned: FARMING_CONFIG.duration * FARMING_CONFIG.pointsPerSecond,
          });
        } else {
          // In progress
          setFarmingState({
            isFarming: true,
            canClaim: false,
            remainingTime: FARMING_CONFIG.duration - elapsedSeconds,
            pointsEarned: elapsedSeconds * FARMING_CONFIG.pointsPerSecond,
          });
        }
      } else {
        // Not started
        setFarmingState({
          isFarming: false,
          canClaim: false,
          remainingTime: FARMING_CONFIG.duration,
          pointsEarned: 0,
        });
      }
    });

    return () => unsubscribe();
  }, [user?.id]);

  // Local timer for smooth UI countdown (optional, but good for UX)
  // The onValue handles the truth, this just tick-tocks locally between updates if needed.
  // Actually, onValue might not fire every second if we don't write every second.
  // So we SHOULD run a local interval that calculates based on the FETCHED startTime.
  useEffect(() => {
    let interval;
    if (farmingState.isFarming && farmingState.remainingTime > 0) {
      interval = setInterval(() => {
        setFarmingState(prev => {
           if (prev.remainingTime <= 1) {
             // Let the onValue/logic handle the transition to claim
             return prev;
           }
           return {
             ...prev,
             remainingTime: prev.remainingTime - 1,
             pointsEarned: prev.pointsEarned + FARMING_CONFIG.pointsPerSecond
           };
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [farmingState.isFarming]);


  const startFarming = async () => {
    if (!user?.id) return;
    try {
      await update(farmingRef, {
        startTime: Date.now(),
      });
    } catch (err) {
      console.error("Failed to start farming:", err);
    }
  };

  const claimPoints = async () => {
    if (!farmingState.canClaim || !user?.id) return;

    try {
      const scoreRef = ref(database, `users/${user.id}/Score`);
      const pointsToClaim = Math.floor(farmingState.pointsEarned); // Integers preferred? Or float? Config says 100/3600 which is float.
      const safePoints = 1200; // Original code had hardcoded 1200. Config says 100 points total? 
      // User's original code had `points: 1200` in log but `farmingState.pointsEarned` in score.
      // 43200 seconds = 12 hours. 100 points total.
      // I will trust `pointsEarned` but cap it or ensure it matches config.
      // Wait, original code log said 1200.
      // Let's use `pointsEarned`.

      await runTransaction(scoreRef, (currentData) => {
         if (!currentData) return { farming_score: pointsToClaim, total_score: pointsToClaim, task_updated_at: Date.now() };
         return {
           ...currentData,
           farming_score: (Number(currentData.farming_score) || 0) + pointsToClaim,
           total_score: (Number(currentData.total_score) || 0) + pointsToClaim,
           task_updated_at: Date.now()
         };
      });

      // Reset farming state in DB
      await update(farmingRef, { startTime: null }); // Or remove it
      // actually remove is better
      // await remove(farmingRef); // import remove if needed, or set to null.

      addHistoryLog(user.id, {
        action: 'Farming Claimed',
        points: pointsToClaim,
        type: 'Farming',
      });

    } catch (error) {
      console.error("Error claiming points:", error);
    }
  };

  return { farmingState, startFarming, claimPoints };
};

export default useFarming;
