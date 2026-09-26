//! JPEG compression through libjpeg-turbo, the standard fast JPEG library,
//! which every major Linux distribution ships (and most desktops have
//! installed, as so much depends on it). It is loaded when first needed, not
//! linked, so the plugin still runs where it is missing, compressing with the
//! image crate's own encoder instead, about three times slower.
//!
//! The TurboJPEG interface used here dates from libjpeg-turbo 1.2 (2012) and is
//! kept in every version since.

use std::ffi::{c_int, c_uchar, c_ulong, c_void};
use std::sync::OnceLock;

type Handle = *mut c_void;
type Init = unsafe extern "C" fn() -> Handle;
type Compress = unsafe extern "C" fn(Handle, *const c_uchar, c_int, c_int, c_int, c_int, *mut *mut c_uchar, *mut c_ulong, c_int, c_int, c_int) -> c_int;
type Free = unsafe extern "C" fn(*mut c_uchar);

// TJPF_RGB and TJSAMP_444: packed RGB in, full colour out (no chroma
// subsampling, which smears thin coloured edges on the deck)
const RGB: c_int = 0;
const FULL_COLOUR: c_int = 0;

struct Turbo {
    _library: libloading::Library,
    init: Init,
    compress: Compress,
    free: Free,
}

fn turbo() -> Option<&'static Turbo> {
    static TURBO: OnceLock<Option<Turbo>> = OnceLock::new();
    TURBO
        .get_or_init(|| {
            let found = unsafe {
                let library = libloading::Library::new("libturbojpeg.so.0").ok()?;
                let init = *library.get::<Init>(b"tjInitCompress\0").ok()?;
                let compress = *library.get::<Compress>(b"tjCompress2\0").ok()?;
                let free = *library.get::<Free>(b"tjFree\0").ok()?;
                Some(Turbo { _library: library, init, compress, free })
            };
            match &found {
                Some(_) => log::info!("Compressing frames with libjpeg-turbo"),
                None => log::info!("libjpeg-turbo not found; compressing frames with the built-in encoder"),
            }
            found
        })
        .as_ref()
}

// one compressor for each thread that compresses, made when it first does
thread_local! {
    static HANDLE: Handle = turbo().map_or(std::ptr::null_mut(), |t| unsafe { (t.init)() });
}

/// Compress packed RGB pixels, `width` by `height`, at a quality from 1 to
/// 100, or None when libjpeg-turbo is not available (or fails).
pub fn compress(rgb: &[u8], width: u32, height: u32, quality: u8) -> Option<Vec<u8>> {
    let t = turbo()?;
    if rgb.len() < (width * height * 3) as usize {
        return None;
    }
    HANDLE.with(|&handle| {
        if handle.is_null() {
            return None;
        }
        let mut out: *mut c_uchar = std::ptr::null_mut();
        let mut size: c_ulong = 0;
        let status = unsafe {
            (t.compress)(handle, rgb.as_ptr(), width as c_int, (width * 3) as c_int, height as c_int, RGB, &mut out, &mut size, FULL_COLOUR, quality.clamp(1, 100) as c_int, 0)
        };
        if out.is_null() {
            return None;
        }
        let jpeg = (status == 0).then(|| unsafe { std::slice::from_raw_parts(out, size as usize) }.to_vec());
        unsafe { (t.free)(out) };
        jpeg
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn compresses_a_picture_it_can_read_back() {
        // a gradient, so the picture has something in it
        let (w, h) = (64u32, 48u32);
        let rgb: Vec<u8> = (0..w * h).flat_map(|i| [(i % w * 4) as u8, (i / w * 5) as u8, 128]).collect();
        let Some(jpeg) = super::compress(&rgb, w, h, 95) else {
            eprintln!("libjpeg-turbo is not installed here; nothing to test");
            return;
        };
        let back = image::load_from_memory(&jpeg).unwrap().to_rgb8();
        assert_eq!(back.dimensions(), (w, h));
        let p = back.get_pixel(40, 30).0;
        assert!(p[0].abs_diff(160) < 8 && p[1].abs_diff(150) < 8 && p[2].abs_diff(128) < 8, "{p:?}");
    }
}
