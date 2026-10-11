import type { LunaUnload } from "@luna/core";
import {
  MediaItem,
  PlayState,
  type redux,
  StyleTag,
  ipcRenderer,
} from "@luna/lib";
import { storage } from "./Settings";

export { Settings } from "./Settings";

export const unloads = new Set<LunaUnload>();

import css from "file://index.css";
import { Root } from "./types";

//#region CSS
new StyleTag("CatJam", unloads, css).add();
//#endregion

// Log what storage loaded on startup (helps debug persistence)
console.log("[CAT-JAM] Storage loaded — activeVideoUrl:", storage.activeVideoUrl);
console.log("[CAT-JAM] Storage loaded — videoLibrary:", JSON.parse(JSON.stringify(storage.videoLibrary)));

//#region CatJam videoElement Element
const videoElement: HTMLVideoElement = document.createElement("video");

videoElement.src = storage.activeVideoUrl;

videoElement.classList.add("CatJam");
videoElement.style = `--catjam-opacity: ${storage.opacity / 100};`;

videoElement.loop = true;
videoElement.muted = true;

// Second video element for the now-playing / mini player view
const nowPlayingVideo: HTMLVideoElement = document.createElement("video");
nowPlayingVideo.src = storage.activeVideoUrl;
nowPlayingVideo.classList.add("CatJam", "CatJam--nowPlaying");
nowPlayingVideo.style = `--catjam-opacity: ${storage.opacity / 100};`;
nowPlayingVideo.loop = true;
nowPlayingVideo.muted = true;
//#endregion

//#region Append CatJam to the media imagery
// A video detached from the page pauses; resume it in step with the music.
const resumeIfPlaying = (video: HTMLVideoElement) => {
  if (PlayState.state === "PLAYING") video.play().catch(() => {});
};

const appendCatJam = () => {
  // Use isConnected, not parentElement: when Tidal replaces an ancestor,
  // the video keeps its (now detached) parent, so a parentElement check
  // would never re-append it.
  if (videoElement.isConnected) return;

  const smallAlbumArt = document.querySelector(
    '[data-test="current-media-imagery"]',
  );
  if (smallAlbumArt) {
    smallAlbumArt.append(videoElement);
    resumeIfPlaying(videoElement);
  }
};

// With animated covers, the now-playing view hides the static artwork
// wrapper and shows a separate animated-art <video> instead, so follow
// whichever one is actually visible.
const getNowPlayingTarget = (): Element | null => {
  const animatedArt = document.querySelector(
    '[data-test="new-now-playing"] video.rl-animated-art-visible',
  );
  if (animatedArt?.parentElement) return animatedArt.parentElement;

  return (
    document.querySelector('[data-test="now-playing-artwork"]')
      ?.parentElement ?? null
  );
};

const appendNowPlayingCatJam = () => {
  const target = getNowPlayingTarget();
  if (!target) return;
  if (nowPlayingVideo.isConnected && nowPlayingVideo.parentElement === target)
    return;

  target.append(nowPlayingVideo);
  nowPlayingVideo.currentTime = videoElement.currentTime;
  resumeIfPlaying(nowPlayingVideo);
};

// Single MutationObserver handles both — re-appends whichever got removed
const observer = new MutationObserver(() => {
  appendCatJam();
  appendNowPlayingCatJam();
});
observer.observe(document.body, { childList: true, subtree: true });
appendCatJam();
appendNowPlayingCatJam();
//#endregion

//#region Add CatJam to unloads
unloads.add(() => {
  videoElement?.remove();
  nowPlayingVideo?.remove();
  observer.disconnect();
  clearTimeout(pendingPlay);
});
//#endregion
type AudioData = null | Root;
let audioData: AudioData = null;

const videoElementDefaultBPM = 135.48;
function getPlaybackRate(): number {
  if (audioData?.audioFeatures?.tempo) {
    const trackBPM = audioData.audioFeatures.tempo;
    const playbackRate = trackBPM / videoElementDefaultBPM;
    console.log("[CAT-JAM] Track BPM:", trackBPM);
    console.log(
      "[CAT-JAM] Cat jam synchronized, playback rate set to:",
      playbackRate,
    );
    return playbackRate;
  } else {
    console.warn(
      "[CAT-JAM] BPM data not available for this track, cat will not be jamming accurately :(",
    );
    return 1;
  }
}

// Helper to sync both video elements together
function playBothVideos() {
  videoElement.currentTime = 0;
  videoElement.play();
  nowPlayingVideo.currentTime = 0;
  nowPlayingVideo.play();
}

function pauseBothVideos() {
  videoElement.pause();
  nowPlayingVideo.pause();
}

function setBothPlaybackRates(rate: number) {
  videoElement.playbackRate = rate;
  nowPlayingVideo.playbackRate = rate;
}

// A beat-aligned play scheduled for later. Cleared on pause so a stale
// timer can't restart the cat after the music has stopped.
let pendingPlay: ReturnType<typeof setTimeout> | undefined;

function schedulePlay(delayMs: number) {
  clearTimeout(pendingPlay);
  pendingPlay = setTimeout(() => {
    pendingPlay = undefined;
    playBothVideos();
  }, delayMs);
}

// `shouldPlay` is passed in rather than read from PlayState.playing: onState
// fires before Redux applies the new state, and PlayState.playing reads
// desiredPlaybackState, which can lag on the first play of a session.
async function syncTiming(
  startTime: number,
  progress: number,
  shouldPlay: boolean,
) {
  if (!shouldPlay) {
    clearTimeout(pendingPlay);
    pendingPlay = undefined;
    pauseBothVideos();
    return;
  }

  const upcomingBeat = audioData?.audioAnalysis?.beats?.find(
    (beat) => beat.start > progress,
  );
  if (upcomingBeat) {
    const operationTime = performance.now() - startTime;
    schedulePlay(
      Math.max(0, (upcomingBeat.start - progress) * 1000 - operationTime),
    );
    console.log("[CAT-JAM] Resynchronized to nearest beat");
  } else {
    playBothVideos();
  }
}

//#region Variables
let _hasBPM = false;
let duration = 0;
//#endregion

//#region Set the current time of the videoElement
const setCurrentTime = () => {
  videoElement.currentTime =
    ((duration || 0) - PlayState.playTime) % videoElement.duration;
};
//#endregion

let lastProgress = 0;

//#region Update CatJam
const updateCatJam = async ({
  type,
  mediaItem,
  playbackState,
}: {
  type: "mediaTransition" | "playbackState" | "load";
  mediaItem?: MediaItem | undefined;
  playbackState?: redux.PlaybackState | undefined;
}) => {
  switch (type) {
    case "mediaTransition": {
      if (mediaItem) {
        const req = await fetch(
          `https://api.vmohammad.dev/lyrics?filter=audioFeatures,audioAnalysis&tidal_id=${mediaItem.id}`,
        );
        if (!req.ok) {
          return;
        }

        audioData = await req.json();
        const startTime = performance.now(); // Record the start time for the operation

        console.log("[CAT-JAM] Audio data fetched:", audioData);

        if (
          audioData &&
          audioData.audioAnalysis &&
          audioData.audioAnalysis.beats &&
          audioData.audioAnalysis.beats.length > 0
        ) {
          const firstBeatStart = audioData.audioAnalysis.beats[0].start; // Get start time of the first beat

          // Adjust video playback rate based on the song's BPM
          setBothPlaybackRates(getPlaybackRate());

          const operationTime = performance.now() - startTime; // Calculate time taken for operations
          const delayUntilFirstBeat = Math.max(
            0,
            firstBeatStart * 1000 - operationTime,
          ); // Calculate delay until the first beat

          if (PlayState.state === "PLAYING") schedulePlay(delayUntilFirstBeat);
        }
      }
      break;
    }
    case "playbackState": {
      const startTime = performance.now();
      syncTiming(startTime, lastProgress, playbackState === "PLAYING");
      break;
    }
    case "load": {
      await updateCatJam({
        type: "mediaTransition",
        mediaItem: await MediaItem.fromPlaybackContext(),
      });
      await updateCatJam({
        type: "playbackState",
        playbackState: PlayState.state,
      });
      break;
    }
  }
};
//#endregion

//#region Listeners
MediaItem.onMediaTransition(unloads, async (mediaItem) => {
  return await updateCatJam({
    type: "mediaTransition",
    mediaItem,
    playbackState: "PAUSED",
  });
});

PlayState.onState(unloads, async (playbackState) => {
  return await updateCatJam({ type: "playbackState", playbackState });
});

videoElement.onloadeddata = async () => {
  return await updateCatJam({ type: "load" });
};
//#endregion

ipcRenderer.on(unloads, "client.playback.playersignal", async (data) => {
  const signal = data.signal;
  if (signal !== "media.currenttime") return;
  const currentTime = performance.now();
  const progress = Math.floor(Number(data.time));

  const delta = progress - lastProgress;

  if (Math.abs(delta) >= 2) {
    // Seek or new track: resync to the nearest beat
    syncTiming(currentTime, progress, PlayState.state === "PLAYING");
  } else if (delta > 0 && videoElement.paused && !pendingPlay) {
    // Safety net: the song's clock is ticking forward normally, so music is
    // playing. If the cat is still paused, a play/pause event was missed.
    console.log("[CAT-JAM] Audio advancing but cat paused — resuming");
    playBothVideos();
  }
  lastProgress = progress;
});

export { nowPlayingVideo };
export default videoElement;
