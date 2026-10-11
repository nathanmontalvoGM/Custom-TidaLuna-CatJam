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
const appendCatJam = () => {
  const smallAlbumArt = document.querySelector(
    '[data-test="current-media-imagery"]',
  );
  if (smallAlbumArt) return smallAlbumArt.append(videoElement);

  return setTimeout(appendCatJam, 1);
};
appendCatJam();

// Watch for the now-playing view and append the second video there
const appendNowPlayingCatJam = () => {
  // Already attached and in the DOM
  if (nowPlayingVideo.parentElement) return;

  const nowPlayingArt = document.querySelector(
    '[data-test="now-playing-artwork"]',
  );
  if (nowPlayingArt?.parentElement) {
    nowPlayingArt.parentElement.append(nowPlayingVideo);
  }
};

// Use a MutationObserver to detect when the now-playing view appears
const observer = new MutationObserver(() => appendNowPlayingCatJam());
observer.observe(document.body, { childList: true, subtree: true });
appendNowPlayingCatJam(); // Try immediately too
//#endregion

//#region Add CatJam to unloads
unloads.add(() => {
  videoElement?.remove();
  nowPlayingVideo?.remove();
  observer.disconnect();
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

async function syncTiming(startTime: number, progress: number) {
  if (videoElement) {
    if (PlayState.playing) {
      if (audioData?.audioAnalysis?.beats) {
        const upcomingBeat = audioData.audioAnalysis.beats.find(
          (beat) => beat.start > progress,
        );
        if (upcomingBeat) {
          const operationTime = performance.now() - startTime;
          const delayUntilNextBeat = Math.max(
            0,
            (upcomingBeat.start - progress) * 1000 - operationTime,
          );
          setTimeout(() => playBothVideos(), delayUntilNextBeat);
        } else {
          playBothVideos();
        }
        console.log("[CAT-JAM] Resynchronized to nearest beat");
      } else {
        playBothVideos();
      }
    } else {
      pauseBothVideos();
    }
  } else {
    console.error("[CAT-JAM] videoElement element not found.");
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

          setTimeout(() => playBothVideos(), delayUntilFirstBeat);
        }
      }
      break;
    }
    case "playbackState": {
      const startTime = performance.now();
      syncTiming(startTime, lastProgress); // Synchronize video timing with the current progress
      break;
    }
    case "load": {
      await updateCatJam({
        type: "mediaTransition",
        mediaItem: await MediaItem.fromPlaybackContext(),
      });
      await updateCatJam({
        type: "playbackState",
        playbackState: PlayState.playing ? "PLAYING" : "PAUSED",
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

  // Check if a significant skip in progress has occurred or if a significant time has passed
  if (Math.abs(progress - lastProgress) >= 2) {
    syncTiming(currentTime, progress); // Synchronize video timing again
  }
  lastProgress = progress; // Update last known progress
});

export { nowPlayingVideo };
export default videoElement;
