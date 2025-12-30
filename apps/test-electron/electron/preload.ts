import { exposeNanoStoreIPC } from "@janhendry/nanostore-ipc-bridge/preload";

exposeNanoStoreIPC({
	channelPrefix: "wf",
	globalName: "nanostoreIPC",
});
