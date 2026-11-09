package com.acmscontrole.mobile;

import android.Manifest;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.net.Uri;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.view.PreviewView;
import androidx.lifecycle.LifecycleOwner;
import androidx.core.content.ContextCompat;

import com.getcapacitor.FileUtils;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.common.util.concurrent.ListenableFuture;

import java.io.File;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "NativeScannerCamera",
    permissions = {
        @Permission(alias = NativeScannerCameraPlugin.CAMERA_PERMISSION, strings = { Manifest.permission.CAMERA })
    }
)
public class NativeScannerCameraPlugin extends Plugin {
    static final String CAMERA_PERMISSION = "camera";

    private ExecutorService cameraExecutor;
    private ProcessCameraProviderHolder providerHolder;
    private Camera camera;
    private ImageCapture imageCapture;
    private FrameLayout cameraContainer;
    private PreviewView previewView;
    private ScannerGuideView guideView;

    @Override
    public void load() {
        super.load();
        cameraExecutor = Executors.newSingleThreadExecutor();
    }

    @Override
    protected void handleOnDestroy() {
        stopCameraInternal(true);
        if (cameraExecutor != null) cameraExecutor.shutdown();
    }

    @PluginMethod
    public void startPreview(PluginCall call) {
        if (getPermissionState(CAMERA_PERMISSION) != PermissionState.GRANTED) {
            requestPermissionForAlias(CAMERA_PERMISSION, call, "cameraPermissionCallback");
            return;
        }
        startPreviewInternal(call);
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        if (getPermissionState(CAMERA_PERMISSION) == PermissionState.GRANTED) {
            startPreviewInternal(call);
        } else {
            call.reject("A permissao da camera e necessaria para digitalizar comprovantes.");
        }
    }

    @PluginMethod
    public void updatePreviewBounds(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (cameraContainer != null) applyBounds(call);
            call.resolve();
        });
    }

    @PluginMethod
    public void setPreviewVisible(PluginCall call) {
        boolean visible = call.getBoolean("visible", true);
        getActivity().runOnUiThread(() -> {
            if (cameraContainer != null) cameraContainer.setVisibility(visible ? View.VISIBLE : View.GONE);
            call.resolve();
        });
    }

    @PluginMethod
    public void setTorch(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) {
            call.reject("Esta camera nao possui lanterna.");
            return;
        }
        camera.getCameraControl().enableTorch(enabled);
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    @PluginMethod
    public void setZoom(PluginCall call) {
        if (camera == null || camera.getCameraInfo().getZoomState().getValue() == null) {
            call.reject("A camera ainda nao esta pronta para alterar o zoom.");
            return;
        }
        float requested = call.getDouble("ratio", 1d).floatValue();
        androidx.camera.core.ZoomState zoomState = camera.getCameraInfo().getZoomState().getValue();
        float clamped = Math.max(zoomState.getMinZoomRatio(), Math.min(zoomState.getMaxZoomRatio(), requested));
        camera.getCameraControl().setZoomRatio(clamped);
        JSObject result = new JSObject();
        result.put("zoom", clamped);
        call.resolve(result);
    }

    @PluginMethod
    public void takePhoto(PluginCall call) {
        ImageCapture capture = imageCapture;
        if (capture == null) {
            call.reject("A camera ainda nao esta pronta.");
            return;
        }
        File output = new File(getContext().getCacheDir(), "scanner-" + UUID.randomUUID() + ".jpg");
        ImageCapture.OutputFileOptions options = new ImageCapture.OutputFileOptions.Builder(output).build();
        capture.takePicture(options, cameraExecutor, new ImageCapture.OnImageSavedCallback() {
            @Override
            public void onImageSaved(@NonNull ImageCapture.OutputFileResults ignored) {
                Uri uri = Uri.fromFile(output);
                JSObject result = new JSObject();
                result.put("webPath", FileUtils.getPortablePath(getContext(), getBridge().getLocalUrl(), uri));
                result.put("uri", uri.toString());
                result.put("mimeType", "image/jpeg");
                call.resolve(result);
            }

            @Override
            public void onError(@NonNull ImageCaptureException error) {
                call.reject("Nao foi possivel salvar a foto da camera.", error);
            }
        });
    }

    @PluginMethod
    public void stopPreview(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            stopCameraInternal(true);
            call.resolve();
        });
    }

    private void startPreviewInternal(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                ensurePreviewView();
                applyBounds(call);
                cameraContainer.setVisibility(View.VISIBLE);
                bindCamera(call);
            } catch (Exception error) {
                call.reject("Nao foi possivel iniciar a camera nativa.", error);
            }
        });
    }

    private void ensurePreviewView() {
        if (cameraContainer != null) return;
        ViewGroup root = getActivity().findViewById(android.R.id.content);
        cameraContainer = new FrameLayout(getContext());
        cameraContainer.setBackgroundColor(Color.BLACK);
        previewView = new PreviewView(getContext());
        previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        cameraContainer.addView(previewView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        guideView = new ScannerGuideView(getContext());
        cameraContainer.addView(guideView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        previewView.setOnTouchListener((view, event) -> {
            if (event.getAction() == MotionEvent.ACTION_UP) focusAt(event.getX(), event.getY());
            return true;
        });
        root.addView(cameraContainer);
    }

    private void applyBounds(PluginCall call) {
        float density = getContext().getResources().getDisplayMetrics().density;
        double pixelRatio = call.getDouble("pixelRatio", (double) density);
        int left = Math.round((float) (call.getDouble("x", 0d) * pixelRatio));
        int top = Math.round((float) (call.getDouble("y", 0d) * pixelRatio));
        int width = Math.max(1, Math.round((float) (call.getDouble("width", 1d) * pixelRatio)));
        int height = Math.max(1, Math.round((float) (call.getDouble("height", 1d) * pixelRatio)));
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(width, height);
        params.leftMargin = left;
        params.topMargin = top;
        cameraContainer.setLayoutParams(params);
    }

    private void bindCamera(PluginCall call) {
        ListenableFuture<androidx.camera.lifecycle.ProcessCameraProvider> future = androidx.camera.lifecycle.ProcessCameraProvider.getInstance(getContext());
        future.addListener(() -> {
            try {
                androidx.camera.lifecycle.ProcessCameraProvider provider = future.get();
                providerHolder = new ProcessCameraProviderHolder(provider);
                provider.unbindAll();
                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());
                imageCapture = new ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setJpegQuality(94)
                    .build();
                camera = provider.bindToLifecycle((LifecycleOwner) getActivity(), CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture);
                JSObject result = new JSObject();
                result.put("torchSupported", camera.getCameraInfo().hasFlashUnit());
                androidx.camera.core.ZoomState zoomState = camera.getCameraInfo().getZoomState().getValue();
                if (zoomState != null) {
                    result.put("minZoom", zoomState.getMinZoomRatio());
                    result.put("maxZoom", zoomState.getMaxZoomRatio());
                    result.put("zoom", zoomState.getZoomRatio());
                }
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Nao foi possivel abrir a camera traseira.", error);
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    private void focusAt(float x, float y) {
        if (camera == null || previewView == null) return;
        MeteringPoint point = previewView.getMeteringPointFactory().createPoint(x, y);
        FocusMeteringAction action = new FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF | FocusMeteringAction.FLAG_AE | FocusMeteringAction.FLAG_AWB)
            .setAutoCancelDuration(3, java.util.concurrent.TimeUnit.SECONDS)
            .build();
        camera.getCameraControl().startFocusAndMetering(action);
        if (guideView != null) guideView.showFocus(x, y);
    }

    private void stopCameraInternal(boolean removeView) {
        if (providerHolder != null) providerHolder.provider.unbindAll();
        camera = null;
        imageCapture = null;
        if (removeView && cameraContainer != null) {
            ViewGroup parent = (ViewGroup) cameraContainer.getParent();
            if (parent != null) parent.removeView(cameraContainer);
            cameraContainer = null;
            previewView = null;
            guideView = null;
        }
    }

    private static final class ProcessCameraProviderHolder {
        final androidx.camera.lifecycle.ProcessCameraProvider provider;
        ProcessCameraProviderHolder(androidx.camera.lifecycle.ProcessCameraProvider provider) { this.provider = provider; }
    }

    private static final class ScannerGuideView extends View {
        private final Paint guidePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint focusPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private float focusX = -1;
        private float focusY = -1;

        ScannerGuideView(android.content.Context context) {
            super(context);
            setWillNotDraw(false);
            guidePaint.setColor(Color.rgb(32, 133, 255));
            guidePaint.setStyle(Paint.Style.STROKE);
            guidePaint.setStrokeWidth(4 * getResources().getDisplayMetrics().density);
            focusPaint.setColor(Color.WHITE);
            focusPaint.setStyle(Paint.Style.STROKE);
            focusPaint.setStrokeWidth(2 * getResources().getDisplayMetrics().density);
        }

        void showFocus(float x, float y) {
            focusX = x;
            focusY = y;
            invalidate();
            postDelayed(() -> { focusX = -1; invalidate(); }, 800);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float pad = 24 * getResources().getDisplayMetrics().density;
            float length = 30 * getResources().getDisplayMetrics().density;
            float w = getWidth();
            float h = getHeight();
            drawCorner(canvas, pad, pad, length, 1, 1);
            drawCorner(canvas, w - pad, pad, length, -1, 1);
            drawCorner(canvas, pad, h - pad, length, 1, -1);
            drawCorner(canvas, w - pad, h - pad, length, -1, -1);
            if (focusX >= 0) canvas.drawCircle(focusX, focusY, 28 * getResources().getDisplayMetrics().density, focusPaint);
        }

        private void drawCorner(Canvas canvas, float x, float y, float length, float horizontal, float vertical) {
            canvas.drawLine(x, y, x + horizontal * length, y, guidePaint);
            canvas.drawLine(x, y, x, y + vertical * length, guidePaint);
        }
    }
}
