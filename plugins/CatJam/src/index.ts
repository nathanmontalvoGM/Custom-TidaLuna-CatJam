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
//#endregion

//#region Add CatJam to unloads
unloads.add(() => videoElement?.remove());
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

async function syncTiming(startTime: number, progress: number) {
  if (videoElement) {
    if (PlayState.playing) {
      //progress = progress / 1000; // Convert progress from milliseconds to seconds

      if (audioData?.audioAnalysis?.beats) {
        // Find the nearest upcoming beat based on current progress
        const upcomingBeat = audioData.audioAnalysis.beats.find(
          (beat) => beat.start > progress,
        );
        if (upcomingBeat) {
          const operationTime = performance.now() - startTime; // Time taken for the operation
          const delayUntilNextBeat = Math.max(
            0,
            (upcomingBeat.start - progress) * 1000 - operationTime,
          ); // Calculate delay until the next beat

          setTimeout(() => {
            videoElement.currentTime = 0; // Reset videoElement to start
            videoElement.play(); // Play the videoElement
          }, delayUntilNextBeat);
        } else {
          videoElement.currentTime = 0; // Reset videoElement to start if no upcoming beat
          videoElement.play();
        }
        console.log("[CAT-JAM] Resynchronized to nearest beat");
      } else {
        videoElement.currentTime = 0; // Play the videoElement without delay if no beat information
        videoElement.play();
      }
    } else {
      videoElement.pause(); // Pause the videoElement if Spotify is not playing
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
          videoElement.playbackRate = getPlaybackRate();

          const operationTime = performance.now() - startTime; // Calculate time taken for operations
          const delayUntilFirstBeat = Math.max(
            0,
            firstBeatStart * 1000 - operationTime,
          ); // Calculate delay until the first beat

          setTimeout(() => {
            videoElement.currentTime = 0; // Ensure video starts from the beginning
            videoElement.play(); // Play the video
          }, delayUntilFirstBeat);
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

export default videoElement;
