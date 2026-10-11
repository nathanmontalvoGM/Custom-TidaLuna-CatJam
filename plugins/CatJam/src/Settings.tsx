import { ReactiveStore } from "@luna/core";

import { LunaNumberSetting, LunaSettings } from "@luna/ui";
import React from "react";

const DEFAULT_VIDEO_URL =
	"https://cdn.jsdelivr.net/gh/wont-stream/neptune-plugins@dev/plugins/Catto/src/catjam.webm";

export interface VideoEntry {
	name: string;
	url: string;
}

export const storage = await ReactiveStore.getPluginStorage("CatJam", {
	opacity: 80,
	activeVideoUrl: DEFAULT_VIDEO_URL,
	videoLibrary: [
		{ name: "CatJam (default)", url: DEFAULT_VIDEO_URL },
	] as VideoEntry[],
});

import element, { nowPlayingVideo } from ".";

export const Settings = () => {
	const [opacity, setOpacity] = React.useState(storage.opacity);
	const [activeUrl, setActiveUrl] = React.useState(storage.activeVideoUrl);
	const [library, setLibrary] = React.useState<VideoEntry[]>(() => {
		// Read from storage and clone to get plain objects (strip proxy wrappers)
		const stored = storage.videoLibrary;
		if (Array.isArray(stored) && stored.length > 0) {
			return stored.map((v: VideoEntry) => ({ name: String(v.name), url: String(v.url) }));
		}
		return [{ name: "CatJam (default)", url: DEFAULT_VIDEO_URL }];
	});
	const [newName, setNewName] = React.useState("");
	const [newUrl, setNewUrl] = React.useState("");
	const [error, setError] = React.useState("");

	const onOpacityChange = React.useCallback((value: number) => {
		const opacityStyle = `--catjam-opacity: ${value / 100};`;
		element.style = opacityStyle;
		nowPlayingVideo.style = opacityStyle;
		setOpacity((storage.opacity = value));
	}, []);

	// Strip oby proxy wrappers before writing to IndexedDB.
	// Reactive proxies can interfere with IndexedDB's structured clone,
	// so we create plain objects to guarantee persistence.
	const cloneLibrary = (lib: VideoEntry[]): VideoEntry[] =>
		lib.map((v) => ({ name: String(v.name), url: String(v.url) }));

	const selectVideo = React.useCallback(
		(url: string) => {
			storage.activeVideoUrl = url;
			setActiveUrl(url);
			element.src = url;
			nowPlayingVideo.src = url;
			console.log("[CAT-JAM] Selected video:", url);
		},
		[],
	);

	const addVideo = React.useCallback(() => {
		const trimmedName = newName.trim();
		const trimmedUrl = newUrl.trim();

		if (!trimmedName) {
			setError("Enter a name for this video.");
			return;
		}
		if (!trimmedUrl) {
			setError("Enter a URL.");
			return;
		}
		if (!/^https?:\/\/.+\.(mp4|webm)/i.test(trimmedUrl)) {
			setError("URL must point to an .mp4 or .webm file.");
			return;
		}
		if (library.some((v) => v.url === trimmedUrl)) {
			setError("This URL is already in your library.");
			return;
		}

		const entry: VideoEntry = { name: trimmedName, url: trimmedUrl };
		const updated = cloneLibrary([...library, entry]);
		storage.videoLibrary = updated;
		setLibrary(updated);
		setNewName("");
		setNewUrl("");
		setError("");
		console.log("[CAT-JAM] Video added, library now:", updated);
	}, [newName, newUrl, library]);

	const removeVideo = React.useCallback(
		(url: string) => {
			const updated = cloneLibrary(library.filter((v) => v.url !== url));
			storage.videoLibrary = updated;
			setLibrary(updated);
			// If the removed video was active, fall back to default
			if (activeUrl === url) {
				selectVideo(DEFAULT_VIDEO_URL);
			}
			console.log("[CAT-JAM] Video removed, library now:", updated);
		},
		[library, activeUrl, selectVideo],
	);

	const inputStyle: React.CSSProperties = {
		width: "100%",
		padding: "8px 12px",
		borderRadius: "6px",
		border: "1px solid rgba(255,255,255,0.15)",
		background: "rgba(255,255,255,0.06)",
		color: "inherit",
		fontSize: "13px",
		outline: "none",
		boxSizing: "border-box",
	};

	const buttonStyle: React.CSSProperties = {
		padding: "6px 16px",
		borderRadius: "6px",
		border: "none",
		cursor: "pointer",
		fontSize: "13px",
		fontWeight: 600,
	};

	return (
		<LunaSettings>
			<LunaNumberSetting
				title="CatJam Opacity"
				desc="Adjust the opacity of the CatJam buddy"
				min={0}
				max={100}
				step={1}
				value={opacity}
				onNumber={onOpacityChange}
			/>

			{/* Video Library */}
			<div style={{ padding: "12px 0" }}>
				<h3
					style={{
						margin: "0 0 8px",
						fontSize: "14px",
						fontWeight: 600,
					}}
				>
					Video Library
				</h3>
				<p
					style={{
						margin: "0 0 12px",
						fontSize: "12px",
						opacity: 0.6,
					}}
				>
					Add .mp4 or .webm URLs and pick which video the cat jams
					with.
				</p>

				{/* List of videos */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: "6px",
						marginBottom: "12px",
					}}
				>
					{library.map((entry) => (
						<div
							key={entry.url}
							style={{
								display: "flex",
								alignItems: "center",
								gap: "8px",
								padding: "8px 10px",
								borderRadius: "6px",
								background:
									activeUrl === entry.url
										? "rgba(80,200,120,0.15)"
										: "rgba(255,255,255,0.04)",
								border:
									activeUrl === entry.url
										? "1px solid rgba(80,200,120,0.4)"
										: "1px solid rgba(255,255,255,0.08)",
							}}
						>
							<span
								style={{
									flex: 1,
									fontSize: "13px",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
								title={entry.url}
							>
								{entry.name}
							</span>

							{activeUrl !== entry.url && (
								<button
									type="button"
									onClick={() => selectVideo(entry.url)}
									style={{
										...buttonStyle,
										background: "rgba(255,255,255,0.1)",
										color: "inherit",
									}}
								>
									Use
								</button>
							)}
							{activeUrl === entry.url && (
								<span
									style={{
										fontSize: "12px",
										opacity: 0.7,
										fontWeight: 600,
									}}
								>
									Active
								</span>
							)}
							{entry.url !== DEFAULT_VIDEO_URL && (
								<button
									type="button"
									onClick={() => removeVideo(entry.url)}
									style={{
										...buttonStyle,
										background: "rgba(255,80,80,0.15)",
										color: "#ff6b6b",
									}}
								>
									✕
								</button>
							)}
						</div>
					))}
				</div>

				{/* Add new video */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: "6px",
					}}
				>
					<input
						type="text"
						placeholder="Video name (e.g. Vibing Cat)"
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
						style={inputStyle}
					/>
					<input
						type="text"
						placeholder="Video URL (.mp4 or .webm)"
						value={newUrl}
						onChange={(e) => setNewUrl(e.target.value)}
						style={inputStyle}
					/>
					{error && (
						<span
							style={{
								fontSize: "12px",
								color: "#ff6b6b",
							}}
						>
							{error}
						</span>
					)}
					<button
						type="button"
						onClick={addVideo}
						style={{
							...buttonStyle,
							background: "rgba(80,200,120,0.2)",
							color: "#50c878",
							alignSelf: "flex-start",
						}}
					>
						+ Add Video
					</button>
				</div>
			</div>
		</LunaSettings>
	);
};
