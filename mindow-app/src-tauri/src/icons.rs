// Process icon extraction module: uses Windows Shell API to get exe icons
// and converts them to base64 PNG for frontend display.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::sync::Mutex;

use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};
use windows::Win32::Graphics::Gdi::{
    GetDIBits, GetObjectW, CreateCompatibleDC, DeleteDC, SelectObject,
    BITMAP, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, DeleteObject,
};

/// Global icon cache: exe_path -> base64-encoded PNG/BMP data
static ICON_CACHE: std::sync::OnceLock<Mutex<HashMap<String, String>>> = std::sync::OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, String>> {
    ICON_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Convert a Rust string to null-terminated UTF-16.
fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

/// Get the icon for an exe path as a base64-encoded data URL.
/// Returns cached result if available.
pub fn get_icon_base64(exe_path: &str) -> Option<String> {
    // Check cache first
    {
        let cache_map = cache().lock().ok()?;
        if let Some(cached) = cache_map.get(exe_path) {
            return Some(cached.clone());
        }
    }

    // Extract icon
    let result = extract_icon_pixels(exe_path)?;

    // Encode as PNG data URL (proper alpha transparency support)
    let data_url = encode_rgba_as_png_data_url(&result.pixels, result.width, result.height);

    // Cache it
    if let Ok(mut cache_map) = cache().lock() {
        cache_map.insert(exe_path.to_string(), data_url.clone());
    }

    Some(data_url)
}

struct IconPixels {
    pixels: Vec<u8>, // RGBA
    width: u32,
    height: u32,
}

/// Extract icon pixels from an exe path using SHGetFileInfoW.
fn extract_icon_pixels(exe_path: &str) -> Option<IconPixels> {
    unsafe {
        let wide_path = to_wide(exe_path);
        let mut file_info = SHFILEINFOW::default();

        let result = SHGetFileInfoW(
            windows::core::PCWSTR(wide_path.as_ptr()),
            windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL,
            Some(&mut file_info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );

        if result == 0 || file_info.hIcon.is_invalid() {
            return None;
        }

        let hicon = file_info.hIcon;

        // Get icon info to access the bitmaps
        let mut icon_info = ICONINFO::default();
        if GetIconInfo(hicon, &mut icon_info).is_err() {
            DestroyIcon(hicon).ok();
            return None;
        }

        // Get bitmap dimensions
        let mut bm = BITMAP::default();
        let bm_size = std::mem::size_of::<BITMAP>() as i32;
        let color_bmp = icon_info.hbmColor;

        if color_bmp.is_invalid() {
            DestroyIcon(hicon).ok();
            if !icon_info.hbmMask.is_invalid() { DeleteObject(icon_info.hbmMask).ok(); }
            return None;
        }

        GetObjectW(color_bmp, bm_size, Some(&mut bm as *mut _ as *mut _));
        let width = bm.bmWidth as u32;
        let height = bm.bmHeight as u32;

        if width == 0 || height == 0 {
            DestroyIcon(hicon).ok();
            DeleteObject(color_bmp).ok();
            if !icon_info.hbmMask.is_invalid() { DeleteObject(icon_info.hbmMask).ok(); }
            return None;
        }

        // Create a device context and extract pixels
        let hdc = CreateCompatibleDC(None);
        let old_bmp = SelectObject(hdc, color_bmp);

        let mut bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0, // BI_RGB
                ..Default::default()
            },
            ..Default::default()
        };

        let pixel_count = (width * height) as usize;
        let mut bgra_pixels: Vec<u8> = vec![0u8; pixel_count * 4];

        GetDIBits(
            hdc,
            color_bmp,
            0,
            height,
            Some(bgra_pixels.as_mut_ptr() as *mut _),
            &mut bi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc, old_bmp);
        DeleteDC(hdc).ok();

        // Convert BGRA to RGBA, preserving alpha channel
        let mut rgba_pixels = Vec::with_capacity(pixel_count * 4);
        for i in 0..pixel_count {
            let offset = i * 4;
            let b = bgra_pixels[offset];
            let g = bgra_pixels[offset + 1];
            let r = bgra_pixels[offset + 2];
            let a = bgra_pixels[offset + 3];
            rgba_pixels.push(r);
            rgba_pixels.push(g);
            rgba_pixels.push(b);
            // Preserve original alpha; treat fully-black-zero-alpha as transparent
            rgba_pixels.push(if a == 0 && r == 0 && g == 0 && b == 0 { 0 } else { a });
        }

        // Cleanup
        DestroyIcon(hicon).ok();
        DeleteObject(color_bmp).ok();
        if !icon_info.hbmMask.is_invalid() { DeleteObject(icon_info.hbmMask).ok(); }

        Some(IconPixels { pixels: rgba_pixels, width, height })
    }
}

/// Encode RGBA pixels as a PNG data URL (base64) with proper alpha transparency.
fn encode_rgba_as_png_data_url(rgba: &[u8], width: u32, height: u32) -> String {
    use image::{ImageBuffer, Rgba};
    use std::io::Cursor;

    let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width, height, rgba.to_vec())
            .expect("RGBA buffer size mismatch");

    let mut png_bytes = Vec::new();
    let mut cursor = Cursor::new(&mut png_bytes);
    img.write_to(&mut cursor, image::ImageFormat::Png)
        .expect("PNG encoding failed");

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    format!("data:image/png;base64,{}", b64)
}
