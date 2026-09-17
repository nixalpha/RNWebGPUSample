import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, PixelRatio, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { Canvas, type CanvasRef } from "react-native-wgpu";
import { useFocusEffect, router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DEMO, BENCHMARK_SCENES } from "../gaussian/assets";
import { NativeGaussianSession } from "../gaussian/native-session";
import type { FrameStats, Quality, SceneSource, ViewerStatus } from "../gaussian/types";
import { MAX_FILE_BYTES } from "../visionary/memory";

export interface GaussianViewerProps {
  source?: SceneSource;
  onStatus?: (status: ViewerStatus) => void;
}

export function GaussianViewer({ source = DEMO, onStatus }: GaussianViewerProps) {
  const canvasRef = useRef<CanvasRef>(null);
  const sessionRef = useRef<NativeGaussianSession | null>(null);
  const [session, setSession] = useState<NativeGaussianSession | null>(null);
  const [selected, setSelected] = useState<SceneSource>(source);
  const [status, setStatus] = useState<ViewerStatus>({ phase: "initializing", message: "Waiting for canvas" });
  const [stats, setStats] = useState<FrameStats | null>(null);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [quality, setQuality] = useState<Quality>(1);
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  const [restart, setRestart] = useState(0);
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [picking, setPicking] = useState(false);
  const mounted = useRef(true);
  const ownedCacheFiles = useRef(new Set<string>());
  const statusCallback = useRef(onStatus);
  statusCallback.current = onStatus;
  const insets = useSafeAreaInsets();
  const active = focused && foreground;
  const activeRef = useRef(active);
  activeRef.current = active;
  const readyForCanvas = layout.width > 0 && layout.height > 0;

  const report = useCallback((next: ViewerStatus) => {
    if (!mounted.current) return;
    setStatus(next);
    statusCallback.current?.(next);
  }, []);

  useEffect(() => { setSelected(source); }, [source]);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => { setFocused(false); sessionRef.current?.setActive(false); };
  }, []));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      // Stop immediately; do not wait for React's next effect to reach the surface.
      if (state !== "active") sessionRef.current?.setActive(false);
      setForeground(state === "active");
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const uri of ownedCacheFiles.current) {
        try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* OS may have cleared its cache. */ }
      }
      ownedCacheFiles.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!readyForCanvas) return;
    let cancelled = false;
    let frame: number | null = null;
    let current: NativeGaussianSession | null = null;
    let attempts = 0;
    setSession(null);
    setStats(null);
    report({ phase: "initializing", message: "Preparing native canvas" });
    const start = () => {
      if (cancelled) return;
      try {
        const context = canvasRef.current?.getContext("webgpu");
        if (!context) {
          if (++attempts >= 120) throw new Error("The WebGPU canvas is unavailable. Tap Retry.");
          frame = requestAnimationFrame(start);
          return;
        }
        current = new NativeGaussianSession(context,
          (next) => { if (!cancelled) report(next); },
          (next) => { if (!cancelled) setStats(next); });
        sessionRef.current = current;
        current.resize(layoutRef.current.width, layoutRef.current.height, PixelRatio.get(), qualityRef.current);
        const initializing = current;
        void initializing.initialize().then(() => {
          if (cancelled) return;
          initializing.setActive(activeRef.current);
          setSession(initializing);
        }).catch((error) => {
          if (!cancelled) report({ phase: "error", message: error instanceof Error ? error.message : String(error) });
        });
      } catch (error) {
        report({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      }
    };
    start();
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      current?.dispose();
      if (sessionRef.current === current) sessionRef.current = null;
    };
  }, [readyForCanvas, restart, report]);

  useEffect(() => { session?.resize(layout.width, layout.height, PixelRatio.get(), quality); }, [session, layout, quality]);
  useEffect(() => { session?.setActive(active); }, [session, active]);
  useEffect(() => {
    if (session) { setStats(null); void session.load(selected); }
  }, [session, selected]);

  const gestures = useMemo(() => {
    let orbitX = 0, orbitY = 0, panX = 0, panY = 0, scale = 1;
    const orbit = Gesture.Pan().maxPointers(1).runOnJS(true)
      .onBegin(() => { orbitX = 0; orbitY = 0; })
      .onUpdate((event) => {
        sessionRef.current?.orbitBy(event.translationX - orbitX, event.translationY - orbitY);
        orbitX = event.translationX; orbitY = event.translationY;
      });
    const pan = Gesture.Pan().minPointers(2).maxPointers(2).averageTouches(true).runOnJS(true)
      .onStart((event) => { panX = event.translationX; panY = event.translationY; })
      .onUpdate((event) => {
        sessionRef.current?.panBy(event.translationX - panX, event.translationY - panY);
        panX = event.translationX; panY = event.translationY;
      });
    const pinch = Gesture.Pinch().runOnJS(true).onStart(() => { scale = 1; })
      .onUpdate((event) => { sessionRef.current?.zoomBy(event.scale / scale); scale = event.scale; });
    return Gesture.Simultaneous(orbit, pan, pinch);
  }, []);

  const pick = async () => {
    setPicking(true);
    try {
      // Android providers frequently label PLY/SPLAT as application/octet-stream.
      const result = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: false, copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets[0];
      const isOwnCache = asset.uri.startsWith(Paths.cache.uri);
      if (isOwnCache) ownedCacheFiles.current.add(asset.uri);
      if (!mounted.current) {
        if (isOwnCache) { try { new File(asset.uri).delete(); } catch {} }
        return;
      }
      if (!/\.(ply|splat)$/i.test(asset.name) || /\.compressed\.ply$/i.test(asset.name)) {
        report({ phase: "error", message: "Choose a standard Gaussian .ply or .splat file." });
        return;
      }
      if (asset.size !== undefined && asset.size > MAX_FILE_BYTES) {
        report({ phase: "error", message: "Choose a file smaller than 128 MiB." });
        return;
      }
      setSelected({ kind: "file", uri: asset.uri, name: asset.name, size: asset.size });
    } catch (error) {
      report({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    } finally { if (mounted.current) setPicking(false); }
  };

  const busy = status.phase === "initializing" || status.phase === "loading";
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={action}
      style={({ pressed }) => [styles.button, (pressed || disabled) && styles.dim]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.header}>
        <View style={styles.row}>
          <Text style={styles.title}>Visionary</Text>
          <Text style={styles.subtitle}>Gaussian splats · WebGPU</Text>
        </View>
        <View style={styles.row}>
          {button(picking ? "Opening…" : "Open file", () => { void pick(); }, picking || status.phase === "initializing")}
          {button("Load demo", () => setSelected({ ...DEMO }), status.phase === "initializing")}
          {button("Reset camera", () => session?.resetCamera(), !session)}
        </View>
      </View>
      <GestureDetector gesture={gestures}>
        <View style={styles.viewport} onLayout={({ nativeEvent }) => {
          const { width, height } = nativeEvent.layout;
          setLayout({ width, height });
        }}>
          <Canvas key={restart} ref={canvasRef} style={StyleSheet.absoluteFill} />
          {busy && <View pointerEvents="box-none" style={styles.overlay}>
            <View style={styles.card} accessibilityLiveRegion="polite">
              <ActivityIndicator color="#86d7ff" />
              <Text style={styles.message}>{status.message}</Text>
              {status.progress !== undefined && <Text style={styles.hint}>{Math.round(status.progress * 100)}%</Text>}
              {status.phase === "loading" && button("Cancel", () => session?.cancelLoading())}
            </View>
          </View>}
          {(status.phase === "error" || status.phase === "cancelled") && <View pointerEvents="box-none" style={styles.overlay}>
            <View style={styles.card} accessibilityLiveRegion="polite">
              <Text style={styles.message}>{status.message}</Text>
              {button("Retry", () => setRestart((value) => value + 1))}
              {button("Reload demo", () => { setSelected({ ...DEMO }); setRestart((value) => value + 1); })}
            </View>
          </View>}
        </View>
      </GestureDetector>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Text numberOfLines={1} style={styles.message}>{selected.name}</Text>
        <Text style={styles.hint}>Drag to orbit · Pinch to zoom · Two fingers to pan</Text>
        <View style={styles.row}>
          <Text style={styles.hint}>Resolution</Text>
          {([1, 0.75, 0.5] as Quality[]).map((value) => <Pressable key={value} accessibilityRole="button"
            accessibilityState={{ selected: quality === value }} onPress={() => setQuality(value)}
            style={[styles.quality, quality === value && styles.selected]}>
            <Text style={styles.buttonText}>{value * 100}%</Text>
          </Pressable>)}
        </View>
        {status.pointCount !== undefined && <Text style={styles.hint}>
          {status.pointCount.toLocaleString()} splats · {((status.estimatedGpuBytes ?? 0) / 1048576).toFixed(1)} MiB buffers · {((status.loadMilliseconds ?? 0) / 1000).toFixed(2)}s load
        </Text>}
        {stats && <Text style={styles.hint}>
          JS frames: {stats.fps.toFixed(0)} FPS · median {stats.medianMs.toFixed(1)} / p95 {stats.p95Ms.toFixed(1)} ms · {stats.width}×{stats.height}
        </Text>}
        {__DEV__ && <View style={styles.row}>
          {BENCHMARK_SCENES.map((scene, i) => <Pressable key={scene.name} accessibilityRole="button"
            onPress={() => setSelected(scene)} style={styles.quality}>
            <Text style={styles.hint}>{["64", "50k", "100k", "250k"][i]}</Text>
          </Pressable>)}
          {button("Sphere", () => router.push("/sphere"))}
        </View>}
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0c1017" },
  header: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  title: { color: "#f3f7ff", fontSize: 23, fontWeight: "700" },
  subtitle: { color: "#93a7bd", fontSize: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  viewport: { flex: 1, backgroundColor: "black", minHeight: 100 },
  footer: { padding: 16, gap: 8 },
  button: { backgroundColor: "#233549", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, justifyContent: "center" },
  buttonText: { color: "#ecf4ff", fontSize: 13, fontWeight: "600" },
  dim: { opacity: 0.5 },
  message: { color: "#ecf4ff", fontSize: 14 },
  hint: { color: "#9badc2", fontSize: 12 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { backgroundColor: "rgba(16,25,38,0.96)", padding: 22, borderRadius: 12, gap: 12, maxWidth: 360 },
  quality: { paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, borderRadius: 6, justifyContent: "center" },
  selected: { backgroundColor: "#355476" },
});
