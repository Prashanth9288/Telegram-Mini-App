import { useState, useEffect, useMemo, useRef } from "react";
import { ChevronLeft, Award, Zap, Users, Wallet, CheckSquare, BookOpen, PlayCircle, Send, Twitter, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@radix-ui/react-tabs";
import { Progress } from "../../components/ui/progress.js";
import { useTelegram } from "../../reactContext/TelegramContext";
import { useNavigate } from "react-router-dom";
import { database } from "../../services/FirebaseConfig";
import { ref, onValue, update, runTransaction } from "firebase/database";
import { addHistoryLog } from "../../services/addHistory.js";

const BOT_TOKEN = process.env.REACT_APP_BOT_TOKEN;
export default function TasksPage() {
  const [activeTab, setActiveTab] = useState("daily");
  const { user, scores } = useTelegram();
  const [tasks, setTasks] = useState([]);
  const [filterType, setFilterType] = useState("all");
  const navigate = useNavigate();
  const [clicked, setClick] = useState({ watch: {}, social: false });
  const [verify, setVerify] = useState("");
  const [buttonText, setButtonText] = useState({});
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoTimer, setVideoTimer] = useState(0);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [processingTasks, setProcessingTasks] = useState(new Set()); // New state to lock UI

  useEffect(() => {
    let interval;
    if (selectedVideo && videoTimer > 0) {
      interval = setInterval(() => {
        setVideoTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [selectedVideo, videoTimer]);
  const [membershipStatus, setMembershipStatus] = useState(null);
  const [userTasks, setUserTasks] = useState({});
  const [gameCompleted, setGameCompleted] = useState(false);
  const [newsCount, setnewsCount] = useState(0);
  const [localScores, setLocalScores] = useState(null);

  const userTasksRef = ref(database, `connections/${user?.id}`);
  const userScoreRef = ref(database, `users/${user?.id}/Score`);
  const userId = user?.id;

  const isToday = (timestamp) => {
    if (!timestamp) return false;
    const date = new Date(timestamp);
    const today = new Date();
    return date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
  };

  const isSameWeek = (timestamp) => {
    if (!timestamp) return false;
    const date = new Date(timestamp);
    const today = new Date();
    date.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    // Same week check (reset on Monday)
    const day = today.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1; // Days since last Monday
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - diffToMonday);
    return date >= startOfWeek;
  };

  const isTaskDone = (task) => {
    const { id, type, reset_config, version } = task;
    const userStatus = userTasks?.[id];

    // 1. Not started / Not claimed
    if (userStatus === undefined || userStatus === null || userStatus === false) return false;

    // 2. Version Check (New Feature)
    // If task has a version, and user's claim is older (or legacy 'true'), they must re-do it.
    const taskVersion = version || 0;
    const claimedVersion = (typeof userStatus === 'object') ? (userStatus.version || 0) : 0; // Legacy 'true' = version 0
    
    if (taskVersion > claimedVersion) return false;

    // 3. Config-Driven Reset Logic (The "Rule Book")
    if (reset_config) {
      if (userStatus === true) return false; // Legacy claims on scoped tasks are considered expired to be safe
      
      const lastClaimed = userStatus.lastClaimed;
      if (!lastClaimed) return false;

      if (reset_config.period === 'daily') return isToday(lastClaimed);
      if (reset_config.period === 'weekly') return isSameWeek(lastClaimed);
      // 'once' or 'infinite' falls through to true
    } 
    
    // 4. Legacy Hardcoded Fallbacks (Backward Compatibility)
    // If no reset_config is defined in DB, use old type-based rules
    const LEGACY_RESET_TYPES = ['game', 'news', 'partnership'];
    if (!reset_config && LEGACY_RESET_TYPES.includes(type)) {
       if (userStatus === true) return false; // Legacy boolean 'true' means expired for daily tasks in old system logic? 
       // Actually in old logic: "if (status === true) return false;" for RESET_TYPES. 
       // This implies 'true' was a temporary state or effectively "ready to claim"? 
       // Wait, looking at lines 78-79 of original: "if (status === true) return false;" for RESET_TYPES.
       // Yes, so we keep that behavior.
       
       if (typeof userStatus === 'object' && userStatus.lastClaimed) {
         return isToday(userStatus.lastClaimed);
       }
       return false;
    }

    // Default: It is claimed forever
    return true;
  };

  useEffect(() => {
    if (!user?.id) return;
    const tasksRef = ref(database, "tasks");
    const gameTaskRef = ref(database, `connections/${user.id}/tasks/daily/game`);
    const newsRef = ref(database, `connections/${user.id}/tasks/daily/news`);

    const unsubscribeTasks = onValue(tasksRef, (snapshot) => {
      // Logic from lines 52-62
      if (snapshot.exists()) {
        const data = snapshot.val();
        console.log("Fetched Tasks from Firebase:", data);
        const tasksArray = Object.entries(data).map(([key, task]) => ({
          ...task,
          id: task.id || key,
        }));
        setTasks(tasksArray);
      } else {
        setTasks([]);
      }
    });

    const unsubscribeGame = onValue(gameTaskRef, (snapshot) => {
      const data = snapshot.val();
      if (typeof data === 'boolean') {
         // Legacy support: if true from old system, treat as done (or maybe require replay? let's require replay for strict daily)
         // Actually, to be safe, if boolean true, assume done for today? 
         // But we want to fix the "permanent true" bug.
         // So: Boolean True -> Treat as FALSE (Force Replay) to fix the bug?
         // Or: Boolean True -> Treat as TRUE (User happy) but it never resets.
         // Given the goal "Admin-driven daily reset", we MUST require a timestamp.
         // So: Boolean -> False. (User must play once to get the timestamp).
         setGameCompleted(false);
      } else {
         setGameCompleted(isToday(data?.lastPlayed));
      }
    });

    const unsubscribeNews = onValue(newsRef, (snapshot) => {
      setnewsCount(snapshot.exists() ? Object.keys(snapshot.val() || {}).length : 0);
    });

    const unsubscribeUserTasks = onValue(userTasksRef, (snapshot) => {
      setUserTasks(snapshot.exists() ? snapshot.val() : {});
    });

    const unsubscribeScores = onValue(userScoreRef, (snapshot) => {
      if (snapshot.exists()) {
        setLocalScores(snapshot.val());
      }
    });

    return () => {
      unsubscribeTasks();
      unsubscribeGame();
      unsubscribeNews();
      unsubscribeUserTasks();
      unsubscribeScores();
    };
  }, [user?.id]);

  // Use localScores for real-time updates, fallback to context
  const scoreData = localScores || scores;
  const displayTaskScore = isToday(scoreData?.task_updated_at) ? (scoreData?.task_score || 0) : 0;
  
  const checkIntervalRef = useRef(null);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
    };
  }, []);

  const IconMap = {
    Zap: <Zap className="h-5 w-5 text-indigo-300" />,
    Award: <Award className="h-5 w-5 text-pink-300" />,
    Users: <Users className="h-5 w-5 text-amber-300" />,
    CheckSquare: <CheckSquare className="h-5 w-5 text-emerald-300" />,
    Wallet: <Wallet className="h-5 w-5 text-blue-300" />,
    BookOpen: <BookOpen className="h-5 w-5 text-blue-300" />,
    PlayCircle: <PlayCircle className="h-5 w-5 text-purple-300" />,
    Send: <Send className="h-5 w-5 text-blue-400" />,
    Twitter: <Twitter className="h-5 w-5 text-sky-400" />,
  };

  // Use `points` as primary reward â€” fallback to `score`, then 100
  const weeklyPoints = isSameWeek(scoreData?.weekly_updated_at) ? (scoreData?.weekly_points || 0) : 0;

  const mapTask = (task) => {
    // Check points, then score, then default to 100
    // Ensure it's treated as a number
    const rawReward = task.points !== undefined ? task.points : (task.score !== undefined ? task.score : 100);
    const reward = Number(rawReward) || 0;

    // Normalize icon key to handle case sensitivity (e.g., "users" -> "Users")
    const iconKey = typeof task.icon === 'string'
      ? Object.keys(IconMap).find(k => k.toLowerCase() === task.icon.toLowerCase())
      : null;

    let completedVal = task.completed || 0;
    // Map specific dynamic progress
    if (task.title && task.title.toLowerCase().includes('news')) {
      completedVal = newsCount;
    } else if (task.id == 7 || (task.title && task.title.toLowerCase().includes('500 points'))) {
      completedVal = weeklyPoints;
    }

    return {
      ...task,
      type: (task.title && task.title.toLowerCase().includes('news')) ? 'news' : task.type,
      points: reward, // Normalize to `points` for consistency
      completed: completedVal,
      icon: iconKey ? IconMap[iconKey] : (IconMap['Zap'] || <Zap className="h-5 w-5 text-indigo-300" />),
      iconBg: task.iconBg || "bg-indigo-500/30",
    };
  };

  const processedTasks = useMemo(() => {
    return tasks.map(mapTask).filter(task => 
      !(isTaskDone(task) && !['partnership', 'social'].includes(task.type))
    );
  }, [tasks, userTasks, newsCount, weeklyPoints]); // Dependencies for mapTask and filter

  const dailyTasks = useMemo(() => processedTasks.filter(
    (task) => task.category === 'daily' || task.category === 'standard' || (!task.category && !['weekly', 'achievements'].includes(task.type))
  ), [processedTasks]);

  const weeklyTasks = useMemo(() => processedTasks.filter(task => task.category === 'weekly'), [processedTasks]);
  const achievements = useMemo(() => processedTasks.filter(task => task.category === 'achievements'), [processedTasks]);

  const fetchChatMember = async (chatId, userId) => {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${chatId}&user_id=${userId}`
      );
      const data = await response.json();
      return data.ok ? data.result : null;
    } catch (err) {
      console.error("API Request Failed:", err);
      return null;
    }
  };

  const handleChatId = async () => {
    try {
      const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`);
      const data = await response.json();
      if (data.ok) {
        const chatUpdate = data.result.find(update => update.my_chat_member);
        if (chatUpdate) {
          const chat = chatUpdate.my_chat_member.chat;
          return { chatId: chat.id, chatType: chat.type };
        }
      }
      return { chatId: null, chatType: null };
    } catch (err) {
      console.error("Error fetching chat ID:", err);
      return { chatId: null, chatType: null };
    }
  };

  const startMembershipCheck = async (taskId, chatId, chatType) => {
    let checkCount = 0;
    // Clear any existing interval
    if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);

    checkIntervalRef.current = setInterval(async () => {
      checkCount += 1;
      if (!chatId || !chatType) {
        setButtonText(prev => ({ ...prev, [taskId]: "Failed" }));
        clearInterval(checkIntervalRef.current);
        return;
      }

      const chatMember = await fetchChatMember(chatId, user.id);
      if (!chatMember || !chatMember.status) {
        setButtonText(prev => ({ ...prev, [taskId]: "Failed" }));
        clearInterval(checkIntervalRef.current);
        return;
      }

      let isMember = false;
      const { status } = chatMember;
      if (["group", "supergroup"].includes(chatType)) {
        isMember = ["member", "administrator", "creator"].includes(status);
      } else if (chatType === "channel") {
        isMember = status === "member";
      }

      if (isMember) {
        await update(userTasksRef, { [taskId]: false });
        setButtonText(prev => ({ ...prev, [taskId]: "Claim" }));
        clearInterval(checkIntervalRef.current);
      } else {
        setButtonText(prev => ({ ...prev, [taskId]: "Join Again" }));
        clearInterval(checkIntervalRef.current);
        // Wait, original logic CLEARED interval on failure ("Join Again").
        // This stops checking. If user joins, they must click again.
        // This is fine.
      }

      if (checkCount >= 100) {
        setButtonText(prev => ({ ...prev, [taskId]: "Failed" }));
        clearInterval(checkIntervalRef.current);
      }
    }, 3000);
  };

  const handleSafeClaim = async (task, taskId) => {
    if (processingTasks.has(taskId)) return; // Prevent double clicks
    
    // UI update to show processing
    const updatedButtonTexts = { ...buttonText };
    updatedButtonTexts[taskId] = "Processing...";
    setButtonText(updatedButtonTexts);
    setProcessingTasks(prev => new Set(prev).add(taskId));

    try {
      const taskPoints = Number(task.points) || 0;

      // ATOMIC TRANSACTION: Update scores safely
      await runTransaction(userScoreRef, (currentData) => {
        if (!currentData) {
          // Initialize if missing (edge case)
          return {
            farming_score: 0,
            game_score: 0,
            network_score: 0,
            news_score: 0,
            task_score: taskPoints,
            total_score: taskPoints,
            task_updated_at: Date.now()
          };
        }

        const currentTaskScore = Number(currentData.task_score) || 0;
        const newTaskScore = currentTaskScore + taskPoints;

        // Recalculate total score based on existing values + new task score
        const newTotalScore = (
          (Number(currentData.farming_score) || 0) +
          (Number(currentData.game_score) || 0) +
          (Number(currentData.network_score) || 0) +
          (Number(currentData.news_score) || 0) +
          newTaskScore
        );

        return {
          ...currentData,
          task_score: newTaskScore,
          total_score: newTotalScore,
          task_updated_at: Date.now()
        };
      });

      // Mark task as claimed with Versioning Support
      const claimData = { 
        lastClaimed: Date.now(), 
        status: 'claimed',
        version: task.version || 0 // Save version at time of claim
      };
      await update(userTasksRef, { [taskId]: claimData });

      addHistoryLog(userId, {
        action: 'Task Claimed',
        points: taskPoints,
        type: task.type || 'task',
      });

      // Hide button / Success UI
      const clickBtn = document.getElementById(`clickBtn${taskId}`);
      if (clickBtn) clickBtn.style.display = "none";
      
    } catch (error) {
      console.error("Claim Error:", error);
      updatedButtonTexts[taskId] = "Failed";
      setButtonText(updatedButtonTexts);
      setTimeout(() => setButtonText(prev => ({ ...prev, [taskId]: "Try Again" })), 2000);
    } finally {
      setProcessingTasks(prev => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const handleTitle = async (task, taskId) => {
    const clickBtn = document.getElementById(`clickBtn${taskId}`);
    const currentText = buttonText[taskId] || "Start Task";
    const updatedButtonTexts = { ...buttonText };

    switch (task.type?.toLowerCase()) {
      case "watch":
        if (["Start Task", "Join Again"].includes(currentText) && userTasks[taskId] !== false) {
          // Open Video Modal & Start Timer
          const videoUrl = task.videoUrl || task.url;
          if (videoUrl) {
            setSelectedVideo(videoUrl);
            setVideoTimer(30); // Require 30 seconds watch time
            setActiveTaskId(taskId);
          }
        } else if (userTasks[taskId] === false || currentText === "Claim") {
           await handleSafeClaim(task, taskId);
        }
        break;

      case "social":
        setClick(prev => ({ ...prev, [task.title]: true }));
        if (["Start Task", "Join Again", "Failed"].includes(currentText)) {
          updatedButtonTexts[taskId] = "Checking...";
          setButtonText(updatedButtonTexts);
          window.open(task.url, "_blank");
          const { chatId, chatType } = await handleChatId();
          startMembershipCheck(taskId, chatId, chatType);
        } else if (currentText === "Claim" && userTasks[taskId] === false) {
          await handleSafeClaim(task, taskId);
        }
        break;

      case "partnership":
        navigate("/network");
        break;

      case "misc":
        window.open(task.url, "_blank");
        break;

      case "game":
        if (userTasks[taskId] === false || currentText === "Claim") {
           await handleSafeClaim(task, taskId);
        } else if (["Start Task", "Play Again"].includes(currentText)) {
          navigate("/game");
          if (gameCompleted) {
            update(userTasksRef, { [taskId]: false });
            updatedButtonTexts[taskId] = "Claim";
          } else {
            updatedButtonTexts[taskId] = "Play Again";
          }
          setButtonText(updatedButtonTexts);
        }
        break;

      case "news":
        if (userTasks[taskId] === false || currentText === "Claim") {
          // Double check requirement
          if (newsCount < 5) {
            navigate("/news");
            return;
          }
           await handleSafeClaim(task, taskId);
        } else {
          // Default action: Navigate to news
          navigate("/news");
          // Check if news requirement is met to update status immediately (optional UX improvement)
          if (newsCount >= 5) {
            update(userTasksRef, { [taskId]: false }); // Mark as claimable
            updatedButtonTexts[taskId] = "Claim";
            setButtonText(updatedButtonTexts);
          }
        }
        break;

      default:
        setClick({ watch: {}, social: false });
    }
  };

  const handleVerification = (task, taskId) => {
    const verifycode = `1234${taskId}`;
    const verifyBlock = document.getElementById(`verifyblock-${taskId}`);
    const clickBtn = document.getElementById(`clickBtn${taskId}`);
    if (verifycode === verify + `${taskId}` && verify !== "") {
      verifyBlock.style.display = "none";
      clickBtn.style.display = "block";
      update(userTasksRef, { [taskId]: false });
    }
  };

  const filterTasks = filterType === "all"
    ? processedTasks
    : processedTasks.filter(task => task.type === filterType);

  const handleRoute = (path) => {
    if (path === "referral") {
      navigate(`/network`);
    } else {
      navigate(`/${path}`);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-gradient-to-br from-indigo-600/90 via-purple-600/80 to-pink-600/90">
      {/* Background SVGs unchanged */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/90 via-purple-600/80 to-pink-600/90 z-0">
        <div className="absolute inset-0 opacity-20">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="smallGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="white" strokeWidth="0.5" opacity="0.5" />
              </pattern>
              <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
                <rect width="80" height="80" fill="url(#smallGrid)" />
                <path d="M 80 0 L 0 0 0 80" fill="none" stroke="white" strokeWidth="1" opacity="0.8" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>
        {/* Floating shapes (unchanged) */}
        <div className="absolute top-[10%] left-[20%] w-20 h-20 bg-gradient-to-r from-blue-400 to-indigo-400 opacity-20 blur-xl animate-float"></div>
        <div className="absolute top-[60%] right-[15%] w-24 h-24 bg-gradient-to-r from-purple-400 to-pink-400 opacity-20 blur-xl animate-float-delayed"></div>
        <div className="absolute bottom-[20%] left-[30%] w-16 h-16 bg-gradient-to-r from-amber-400 to-orange-400 opacity-20 blur-xl animate-float-slow"></div>
        <div className="absolute inset-0 opacity-30">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            {[...Array(8)].map((_, i) => (
              <path key={i} d={`M0,${100 + i * 100} C150,${50 + i * 100} 250,${150 + i * 100} 400,${100 + i * 100}`} stroke="white" strokeWidth="0.5" fill="none" />
            ))}
          </svg>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden z-10">
        <header className="sticky top-0 z-10 bg-white/10 backdrop-blur-md border-b border-white/20 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="rounded-full text-white hover:bg-white/10" onClick={() => navigate("/")}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <h1 className="text-xl font-bold text-white">Tasks</h1>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-medium text-sm text-white">{displayTaskScore}</span>
              <Zap className="h-4 w-4 text-amber-300 fill-amber-300" />
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 overflow-auto">
          <div className="mb-6 bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/10">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-medium text-white/80">Your Task Score</h3>
                <p className="text-2xl font-bold text-white">
                  {displayTaskScore} <span className="text-amber-300">XP</span>
                </p>
              </div>
              <div className="bg-white/10 rounded-full p-3">
                <CheckSquare className="h-6 w-6 text-amber-300" />
              </div>
            </div>
          </div>

          <Tabs defaultValue="daily" className="mb-6">
            <TabsList className="flex gap-4 bg-white/10 p-0.5 overflow-auto scroll-hidden">
              {["daily", "weekly", "achievements", "all", "watch", "social", "partnership", "misc"].map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="data-[state=active]:bg-white/20 text-white"
                  onClick={() => {
                    if (["all", "watch", "social", "partnership", "misc"].includes(tab)) {
                      setFilterType(tab);
                    } else {
                      setActiveTab(tab);
                    }
                  }}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="daily" className="mt-4 space-y-3">
              {dailyTasks.map((task) => (
                <Card key={task.id} className="border-none shadow-md bg-white/10 backdrop-blur-md">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`${task.iconBg} p-2 rounded-full mt-1`}>{task.icon}</div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold text-white">{task.title}</h3>
                            <div className="flex flex-col">
                              <p className="text-xs text-white/70 mt-1">
                                {task.description}
                                {isTaskDone(task) && (
                                  <span className="text-white bg-green-500 p-1 ml-1 rounded text-[10px]">Verified ✅</span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 items-end">
                            <Badge className="bg-amber-500/90 whitespace-nowrap">+{task.points} XP</Badge>
                            <button
                              className={`rounded text-white text-sm px-2 py-1 mt-1 whitespace-nowrap ${isTaskDone(task) && task.type !== 'partnership' && task.type !== 'social' ? 'bg-gray-500 cursor-not-allowed' : 'bg-violet-500 hover:bg-violet-700'}`}
                              id={`clickBtn${task.id}`}
                              disabled={isTaskDone(task) && task.type !== 'partnership' && task.type !== 'social'}
                              onClick={() => handleTitle(task, task.id)}
                            >
                              {isTaskDone(task)
                                ? (task.type === 'partnership' || task.type === 'social' ? "Open" : "Done")
                                : (userTasks[task.id] === false && (task.type !== 'news' || newsCount >= 5) ? "Claim" : buttonText[task.id] || "Start Task")
                              }
                            </button>
                          </div>
                        </div>
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-white/70 mb-1">
                            <span>Progress</span>
                            <span>{((task.type === "game" && gameCompleted) || isTaskDone(task) ? task.total : task.completed)}/{task.total}</span>
                          </div>
                          <Progress value={(task.type === "game" && gameCompleted ? 100 : (isTaskDone(task) ? 100 : (task.completed / task.total) * 100))} className="h-1.5 bg-white/10" />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="weekly" className="mt-4 space-y-3">
              {weeklyTasks.map((task) => (
                <Card key={task.id} className="border-none shadow-md bg-white/10 backdrop-blur-md">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`${task.iconBg} p-2 rounded-full mt-1`}>{task.icon}</div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold text-white">{task.title}</h3>
                            <p className="text-xs text-white/70 mt-1">{task.description}</p>
                          </div>
                          <Badge className="bg-amber-500/90">+{task.points} XP</Badge>
                        </div>
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-white/70 mb-1">
                            <span>Progress</span>
                            <span>{((task.type === "game" && gameCompleted) || isTaskDone(task) ? task.total : task.completed)}/{task.total}</span>
                          </div>
                          <Progress value={(isTaskDone(task) ? 100 : (task.completed / task.total) * 100)} className="h-1.5 bg-white/10" />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="achievements" className="mt-4 space-y-3">
              {achievements.map((task) => (
                <Card key={task.id} className="border-none shadow-md bg-white/10 backdrop-blur-md">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`${task.iconBg} p-2 rounded-full mt-1`}>{task.icon}</div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold text-white">{task.title}</h3>
                            <p className="text-xs text-white/70 mt-1">{task.description}</p>
                          </div>
                          <Badge className="bg-amber-500/90">+{task.points} XP</Badge>
                        </div>
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-white/70 mb-1">
                            <span>Progress</span>
                            <span>{((task.type === "game" && gameCompleted) || isTaskDone(task) ? task.total : task.completed)}/{task.total}</span>
                          </div>
                          <Progress value={(task.completed / task.total) * 100} className="h-1.5 bg-white/10" />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value={filterType} className="mt-4 space-y-3">
              {filterTasks.map((task) => {
                const taskId = task.id;
                return (
                  <Card key={task.id} className="border-none shadow-md bg-white/10 backdrop-blur-md">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`${task.iconBg} p-2 rounded-full mt-1`}>{task.icon}</div>
                        <div className="flex-1">
                          <div className="flex justify-between items-start">
                            <div>
                              <h3 className="font-semibold text-white">{task.title}</h3>
                              <div className="flex flex-col">
                                <p className="text-xs text-white/70 mt-1">
                                  {task.description}
                                  {isTaskDone(task) && (
                                    <span className="text-white bg-green-500 p-1 ml-1 rounded text-[10px]">Verified ✅</span>
                                  )}
                                </p>

                              </div>
                            </div>
                            <div className="flex flex-col gap-1 items-end">
                              <Badge className="bg-amber-500/90 whitespace-nowrap">+{task.points} XP</Badge>
                              <button
                                className={`rounded text-white text-sm px-2 py-1 mt-1 whitespace-nowrap ${isTaskDone(task) && task.type !== 'partnership' && task.type !== 'social' ? 'bg-gray-500 cursor-not-allowed' : 'bg-violet-500 hover:bg-violet-700'}`}
                                id={`clickBtn${taskId}`}
                                disabled={isTaskDone(task) && task.type !== 'partnership' && task.type !== 'social'}
                                onClick={() => handleTitle(task, taskId)}
                              >
                                {isTaskDone(task)
                                  ? (task.type === 'partnership' || task.type === 'social' ? "Open" : "Done")
                                  : (userTasks[taskId] === false ? "Claim" : buttonText[taskId] || "Start Task")
                                }
                              </button>
                            </div>
                          </div>
                          <div className="mt-3">
                            <div className="flex justify-between text-xs text-white/70 mb-1">
                              <span>Progress</span>
                              <span>{((task.type === "game" && gameCompleted) || isTaskDone(task) ? task.total : task.completed)}/{task.total}</span>
                            </div>
                            <Progress
                              value={isTaskDone(task) ? 100 : (task.completed / task.total) * 100}
                              className="h-1.5 bg-white/10"
                            />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </TabsContent>
          </Tabs>
        </main>
      </div>
      {/* Video Modal Popup */}
      {selectedVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden w-full max-w-2xl shadow-2xl relative animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center p-4 border-b border-white/10 bg-white/5">
              <h3 className="text-white font-medium">Watch Video</h3>
              <button
                onClick={() => setSelectedVideo(null)}
                className="text-white/70 hover:text-white p-1 hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-video w-full bg-black relative">
              <iframe
                src={selectedVideo.includes('youtube.com/watch?v=') ? selectedVideo.replace('watch?v=', 'embed/') : selectedVideo}
                className="absolute inset-0 w-full h-full"
                title="Task Video"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>
            <div className="p-4 flex justify-between items-center bg-white/5">
              <div className="text-white/70 text-sm">
                {videoTimer > 0 ? `Reward available in ${videoTimer}s` : "Review complete!"}
              </div>
              <button
                disabled={videoTimer > 0}
                onClick={async () => {
                  if (activeTaskId) {
                    await update(userTasksRef, { [activeTaskId]: false });
                    setButtonText(prev => ({ ...prev, [activeTaskId]: "Claim" }));
                    // Auto-claim if desired, but user flow suggests they click "Claim" on the card.
                    // However, if we want to support auto-claim here or just enable the button:
                    // The 'handleSafeClaim' is called when they click "Claim" on the main card.
                    // Here we just mark it as ready-to-claim (false).
                  }
                  setSelectedVideo(null);
                }}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${videoTimer > 0
                  ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                  : "bg-green-600 hover:bg-green-700 text-white"
                  }`}
              >
                {videoTimer > 0 ? `Wait ${videoTimer}s` : "Claim Reward"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
