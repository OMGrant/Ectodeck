//! Native animated backgrounds: Shadertoy-format fragment shaders rendered
//! on the GPU with no window, through EGL and OpenGL ES 3.
//!
//! A shader is the body Shadertoy expects, defining
//! `void mainImage(out vec4 fragColor, in vec2 fragCoord)` and reading the
//! usual uniforms (`iResolution`, `iTime`, `iTimeDelta`, `iFrame`, `iDate`,
//! `iMouse`). Channels (`iChannel0`..) are not provided. Each frame is drawn
//! into an offscreen framebuffer at the panel's size and read back.
//!
//! `iDate` is Shadertoy's: the year, the month from 0, the day of the month
//! and the seconds since midnight, in the computer's local time;
//! `iTimezone` is that time's offset from UTC in seconds, so a shader can
//! work out the sun and moon for any moment.
//!
//! Adjustable parameters follow ISF, the Interactive Shader Format: a JSON
//! comment at the top of the source, `/*{ "INPUTS": [ ... ] }*/`, lists them
//! with NAME, TYPE (float, color, bool, long, point2D), DEFAULT, MIN and MAX.
//! Each becomes a uniform of that name; the host sends values to set.
//!
//! The deck's keys and dials drive the shader as well:
//!
//! - `iMouse`: Shadertoy's pointer, at the centre of the last key pressed.
//!   xy is where it was pressed, zw the same while it is held and negated
//!   after release, as on Shadertoy.
//! - `iKeyPresses[8]`: the eight most recent presses, newest first: xy the
//!   key's centre, z seconds since the press, w the key's index; unused slots
//!   have w = -1.
//! - `iDials`: kept for older shaders, always zero. The deck's dials never
//!   drive a background directly; the app's Background Preset action switches
//!   a background's saved settings instead.
//!
//! Pictures follow ISF's IMPORTED: `"IMPORTED": { "moon": { "PATH": ... } }`
//! makes `moon` a `sampler2D` holding the picture, upright (its bottom row at
//! v = 0), smoothed and mipmapped; `IMG_SIZE(moon)` is its size in pixels.
//! PATH is a `data:` address (the picture inside the source, as a built-in
//! background carries it) or a file's full path; PNG, JPEG, WebP and BMP.
//!
//! An input of TYPE "place" (a city, which the app saves as its name under
//! NAME and its latitude and longitude under NAME + "At") brings the weather
//! there, fetched from Open-Meteo every quarter of an hour (see `weather`):
//!
//! - `iPlace`: latitude, longitude, the place's offset from UTC in seconds,
//!   and 1 once a place is chosen and its weather has come (0 before).
//! - `iWeather`: the WMO weather code (-1 until it has come), the wind or its
//!   gusts in km/h, whichever is stronger, and sunrise and sunset in seconds
//!   after the place's midnight.
//!
//! Multi-pass shaders follow ISF's PASSES: the header lists passes, each
//! drawing into a named TARGET buffer (PERSISTENT to keep its contents from
//! frame to frame, FLOAT for floating-point pixels), and the last pass with
//! no TARGET is the picture shown. The same source runs for every pass with
//! `PASSINDEX` telling it which; every buffer is a `sampler2D` of its name,
//! read with `texture()` or ISF's `IMG_NORM_PIXEL` and `IMG_PIXEL`. A pass
//! may give its buffer a WIDTH and HEIGHT relative to the picture, as ISF
//! writes them ("$WIDTH/4"); `RENDERSIZE` is the size of the pass being
//! drawn, `iResolution` always the picture's. This is what a simulation,
//! such as a fluid, needs: memory between frames, and a coarser grid.
//!
//! An OpenGL context belongs to the thread that made it current, so a
//! renderer is created and used on one thread.

use glow::HasContext;
use image::RgbImage;
use khronos_egl as egl;

const VERTEX: &str = "#version 300 es
void main() {
    // one triangle covering the viewport, no vertex data needed
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}";

const PRELUDE: &str = "#version 300 es
precision highp float;
precision highp int;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform vec4 iMouse;
uniform vec4 iDate;
uniform vec4 iKeyPresses[8];
uniform vec3 iDials;
uniform float iAudioBands[32];
uniform float iAudioLevel;
uniform float iTimezone;
uniform vec4 iPlace;
uniform vec4 iWeather;
out vec4 ectodeckFragColor;
";

/// One adjustable parameter from a shader's ISF header.
#[derive(Clone, Debug, PartialEq)]
pub struct Input {
    pub name: String,
    pub kind: InputKind,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum InputKind {
    Float,
    Color,
    Bool,
    Long,
    Point2D,
    /// A city: not a uniform itself, it brings `iPlace` and `iWeather`.
    Place,
}

impl InputKind {
    fn glsl(self) -> Option<&'static str> {
        match self {
            InputKind::Float => Some("float"),
            InputKind::Color => Some("vec4"),
            InputKind::Bool => Some("bool"),
            InputKind::Long => Some("int"),
            InputKind::Point2D => Some("vec2"),
            InputKind::Place => None,
        }
    }
}

/// The ISF header's INPUTS, with their defaults, or nothing when the source
/// has no header.
pub fn parse_inputs(source: &str) -> (Vec<Input>, serde_json::Map<String, serde_json::Value>) {
    let mut inputs = vec![];
    let mut defaults = serde_json::Map::new();
    let trimmed = source.trim_start();
    let Some(body) = trimmed.strip_prefix("/*") else { return (inputs, defaults) };
    let Some(end) = body.find("*/") else { return (inputs, defaults) };
    let Ok(header) = serde_json::from_str::<serde_json::Value>(body[..end].trim()) else { return (inputs, defaults) };
    for input in header["INPUTS"].as_array().into_iter().flatten() {
        let Some(name) = input["NAME"].as_str() else { continue };
        // a uniform name must be a plain identifier
        if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') || name.starts_with(|c: char| c.is_ascii_digit()) {
            continue;
        }
        let kind = match input["TYPE"].as_str() {
            Some("float") => InputKind::Float,
            Some("color") => InputKind::Color,
            Some("bool") => InputKind::Bool,
            Some("long") => InputKind::Long,
            Some("point2D") => InputKind::Point2D,
            Some("place") => InputKind::Place,
            _ => continue,
        };
        if !input["DEFAULT"].is_null() {
            defaults.insert(name.to_string(), input["DEFAULT"].clone());
        }
        inputs.push(Input { name: name.to_string(), kind });
    }
    (inputs, defaults)
}

/// The ISF header's IMPORTED pictures: each name, a plain identifier, with
/// its PATH.
pub fn parse_imported(source: &str) -> Vec<(String, String)> {
    let trimmed = source.trim_start();
    let Some(body) = trimmed.strip_prefix("/*") else { return vec![] };
    let Some(end) = body.find("*/") else { return vec![] };
    let Ok(header) = serde_json::from_str::<serde_json::Value>(body[..end].trim()) else { return vec![] };
    let Some(imported) = header["IMPORTED"].as_object() else { return vec![] };
    imported
        .iter()
        .filter(|(name, _)| name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && !name.starts_with(|c: char| c.is_ascii_digit()))
        .filter_map(|(name, v)| Some((name.clone(), v["PATH"].as_str()?.to_string())))
        .collect()
}

/// A picture's pixels, from a `data:` address or a file.
fn load_picture(path: &str) -> Result<image::RgbaImage, String> {
    let bytes = if path.starts_with("data:") {
        let url = data_url::DataUrl::process(path).map_err(|e| format!("{e:?}"))?;
        url.decode_to_vec().map_err(|e| format!("{e:?}"))?.0
    } else {
        std::fs::read(path).map_err(|e| e.to_string())?
    };
    Ok(image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8())
}

/// The world outside the deck that a shader may show: the date and time,
/// and the chosen place and its weather.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct World {
    pub date: [f32; 4],
    pub timezone: f32,
    pub place: [f32; 4],
    pub weather: [f32; 4],
}

impl World {
    /// Now, at the place (if one is chosen) with its latest report (if one has come).
    pub fn now(place: Option<(f32, f32)>, report: Option<crate::weather::Report>) -> World {
        let (date, timezone) = local_date();
        let (place, weather) = match (place, report) {
            (Some((lat, lon)), Some(r)) => ([lat, lon, r.offset as f32, 1.0], [r.code as f32, r.wind, r.sunrise, r.sunset]),
            (Some((lat, lon)), None) => ([lat, lon, timezone, 0.0], [-1.0, 0.0, 6.0 * 3600.0, 18.0 * 3600.0]),
            (None, _) => ([0.0, 0.0, timezone, 0.0], [-1.0, 0.0, 6.0 * 3600.0, 18.0 * 3600.0]),
        };
        World { date, timezone, place, weather }
    }
}

/// Shadertoy's iDate in the computer's local time (year, month from 0, day
/// of the month, seconds since midnight) and that time's offset from UTC.
fn local_date() -> ([f32; 4], f32) {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs() as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    if unsafe { libc::localtime_r(&secs, &mut tm) }.is_null() {
        let day = (now.as_secs() % 86_400) as f32;
        return ([1970.0, 0.0, 1.0, day], 0.0);
    }
    let seconds = (tm.tm_hour * 3600 + tm.tm_min * 60 + tm.tm_sec) as f32 + now.subsec_millis() as f32 / 1000.0;
    ([(tm.tm_year + 1900) as f32, tm.tm_mon as f32, tm.tm_mday as f32, seconds], tm.tm_gmtoff as f32)
}

/// What the deck's controls are doing, for the interaction uniforms.
#[derive(Clone, Debug, Default)]
pub struct Interaction {
    /// Shadertoy's iMouse, in panel pixels with the origin at the bottom left.
    pub mouse: [f32; 4],
    /// Newest first: key centre (bottom-left origin), seconds since, index.
    pub presses: Vec<(f32, f32, f32, f32)>,
    /// What is playing: 32 bands and the overall level, each 0 to 1.
    pub audio_bands: [f32; 32],
    pub audio_level: f32,
}

// every channel is kept: buffers use alpha as data; the shown picture's
// alpha is ignored
const EPILOGUE: &str = "
void main() {
    vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
    mainImage(color, gl_FragCoord.xy);
    ectodeckFragColor = color;
}";

/// One pass of a multi-pass shader.
#[derive(Clone, Debug, PartialEq)]
pub struct Pass {
    /// The buffer it draws into, or None for the shown picture.
    pub target: Option<String>,
    pub float: bool,
    /// The buffer's size as a fraction of the picture's, per axis.
    pub scale: (f32, f32),
}

/// An ISF size expression relative to the picture: "$WIDTH", "$WIDTH/4",
/// "$HEIGHT*0.5". Anything else is the full size.
fn size_scale(v: &serde_json::Value) -> f32 {
    let Some(text) = v.as_str() else { return 1.0 };
    let t: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    let rest = t.trim_start_matches("$WIDTH").trim_start_matches("$HEIGHT");
    if rest == t {
        return 1.0;
    }
    let factor = if let Some(n) = rest.strip_prefix('/') {
        n.parse::<f32>().ok().filter(|n| *n > 0.0).map(|n| 1.0 / n)
    } else if let Some(n) = rest.strip_prefix('*') {
        n.parse::<f32>().ok()
    } else if rest.is_empty() {
        Some(1.0)
    } else {
        None
    };
    factor.unwrap_or(1.0).clamp(0.01, 1.0)
}

/// The ISF header's PASSES, or a single pass to the picture when it has none.
pub fn parse_passes(source: &str) -> Vec<Pass> {
    let single = vec![Pass { target: None, float: false, scale: (1.0, 1.0) }];
    let trimmed = source.trim_start();
    let Some(body) = trimmed.strip_prefix("/*") else { return single };
    let Some(end) = body.find("*/") else { return single };
    let Ok(header) = serde_json::from_str::<serde_json::Value>(body[..end].trim()) else { return single };
    let Some(list) = header["PASSES"].as_array() else { return single };
    let mut passes: Vec<Pass> = list
        .iter()
        .map(|p| Pass {
            target: p["TARGET"].as_str().filter(|t| t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')).map(str::to_owned),
            float: p["FLOAT"].as_bool().unwrap_or(false),
            scale: (size_scale(&p["WIDTH"]), size_scale(&p["HEIGHT"])),
        })
        .collect();
    if passes.last().is_none_or(|p| p.target.is_some()) {
        passes.push(Pass { target: None, float: false, scale: (1.0, 1.0) });
    }
    passes
}

/// A buffer a pass draws into: two textures, one read while the other is
/// drawn, swapped after each pass that writes it.
struct Buffer {
    name: String,
    width: u32,
    height: u32,
    textures: [glow::Texture; 2],
    framebuffers: [glow::Framebuffer; 2],
    read: usize,
}

type Egl = egl::DynamicInstance<egl::EGL1_4>;

pub struct ShaderRenderer {
    egl: Egl,
    display: egl::Display,
    context: egl::Context,
    surface: Option<egl::Surface>,
    gl: glow::Context,
    program: glow::Program,
    framebuffer: glow::Framebuffer,
    renderbuffer: glow::Renderbuffer,
    vao: glow::VertexArray,
    width: u32,
    height: u32,
    frame: i32,
    last_time: f32,
    inputs: Vec<Input>,
    defaults: serde_json::Map<String, serde_json::Value>,
    passes: Vec<Pass>,
    buffers: Vec<Buffer>,
    /// the IMPORTED pictures, each a texture under its name
    pictures: Vec<(String, glow::Texture)>,
}

impl ShaderRenderer {
    pub fn new(source: &str, width: u32, height: u32) -> Result<Self, String> {
        let egl = unsafe { Egl::load_required() }.map_err(|e| format!("no EGL library: {e}"))?;
        let display = open_display(&egl)?;
        egl.initialize(display).map_err(|e| format!("EGL initialise failed: {e}"))?;
        egl.bind_api(egl::OPENGL_ES_API).map_err(|e| format!("no OpenGL ES: {e}"))?;

        let attributes = [
            egl::SURFACE_TYPE, egl::PBUFFER_BIT,
            egl::RENDERABLE_TYPE, egl::OPENGL_ES3_BIT,
            egl::RED_SIZE, 8, egl::GREEN_SIZE, 8, egl::BLUE_SIZE, 8, egl::ALPHA_SIZE, 8,
            egl::NONE,
        ];
        let config = egl
            .choose_first_config(display, &attributes)
            .map_err(|e| format!("EGL config: {e}"))?
            .ok_or("no EGL config for OpenGL ES 3 offscreen rendering")?;
        let context = egl
            .create_context(display, config, None, &[egl::CONTEXT_CLIENT_VERSION, 3, egl::NONE])
            .map_err(|e| format!("EGL context: {e}"))?;
        // a 1x1 pbuffer to make the context current on; drawing goes to our framebuffer
        let surface = egl
            .create_pbuffer_surface(display, config, &[egl::WIDTH, 1, egl::HEIGHT, 1, egl::NONE])
            .map_err(|e| format!("EGL pbuffer: {e}"))?;
        egl.make_current(display, Some(surface), Some(surface), Some(context))
            .map_err(|e| format!("EGL make current: {e}"))?;

        let gl = unsafe {
            glow::Context::from_loader_function(|name| {
                egl.get_proc_address(name).map_or(std::ptr::null(), |p| p as *const _)
            })
        };

        let (inputs, defaults) = parse_inputs(source);
        let passes = parse_passes(source);
        // a buffer takes its format and size from the first pass that draws it
        let mut names: Vec<(String, bool, u32, u32)> = vec![];
        for p in &passes {
            if let Some(t) = &p.target {
                if !names.iter().any(|(n, ..)| n == t) {
                    let bw = ((width as f32 * p.scale.0).round() as u32).max(1);
                    let bh = ((height as f32 * p.scale.1).round() as u32).max(1);
                    names.push((t.clone(), p.float, bw, bh));
                }
            }
        }
        unsafe {
            let buffer_names: Vec<String> = names.iter().map(|(n, ..)| n.clone()).collect();
            let imported = parse_imported(source);
            let picture_names: Vec<String> = imported.iter().map(|(n, _)| n.clone()).collect();
            let program = compile(&gl, source, &inputs, &buffer_names, &picture_names)?;
            let mut pictures = vec![];
            for (name, path) in &imported {
                let picture = load_picture(path).map_err(|e| format!("picture {name}: {e}"))?;
                // OpenGL's first row is the bottom one, so the rows go in upside down
                let picture = image::imageops::flip_vertical(&picture);
                let t = gl.create_texture()?;
                gl.bind_texture(glow::TEXTURE_2D, Some(t));
                gl.pixel_store_i32(glow::UNPACK_ALIGNMENT, 1);
                gl.tex_image_2d(glow::TEXTURE_2D, 0, glow::RGBA8 as i32, picture.width() as i32, picture.height() as i32, 0, glow::RGBA, glow::UNSIGNED_BYTE, glow::PixelUnpackData::Slice(Some(picture.as_raw())));
                gl.generate_mipmap(glow::TEXTURE_2D);
                gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MIN_FILTER, glow::LINEAR_MIPMAP_LINEAR as i32);
                gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MAG_FILTER, glow::LINEAR as i32);
                gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_WRAP_S, glow::CLAMP_TO_EDGE as i32);
                gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_WRAP_T, glow::CLAMP_TO_EDGE as i32);
                pictures.push((name.clone(), t));
            }
            let float_ok = gl.supported_extensions().contains("GL_EXT_color_buffer_float");
            let mut buffers = vec![];
            for (name, float, bw, bh) in &names {
                let (internal, kind) = if *float && float_ok { (glow::RGBA32F, glow::FLOAT) } else if *float { (glow::RGBA16F, glow::HALF_FLOAT) } else { (glow::RGBA8, glow::UNSIGNED_BYTE) };
                let linear = !*float || internal == glow::RGBA16F || gl.supported_extensions().contains("GL_OES_texture_float_linear");
                let mut textures = vec![];
                let mut fbos = vec![];
                for _ in 0..2 {
                    let t = gl.create_texture()?;
                    gl.bind_texture(glow::TEXTURE_2D, Some(t));
                    gl.tex_image_2d(glow::TEXTURE_2D, 0, internal as i32, *bw as i32, *bh as i32, 0, glow::RGBA, kind, glow::PixelUnpackData::Slice(None));
                    let filter = if linear { glow::LINEAR } else { glow::NEAREST } as i32;
                    gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MIN_FILTER, filter);
                    gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MAG_FILTER, filter);
                    gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_WRAP_S, glow::CLAMP_TO_EDGE as i32);
                    gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_WRAP_T, glow::CLAMP_TO_EDGE as i32);
                    let f = gl.create_framebuffer()?;
                    gl.bind_framebuffer(glow::FRAMEBUFFER, Some(f));
                    gl.framebuffer_texture_2d(glow::FRAMEBUFFER, glow::COLOR_ATTACHMENT0, glow::TEXTURE_2D, Some(t), 0);
                    if gl.check_framebuffer_status(glow::FRAMEBUFFER) != glow::FRAMEBUFFER_COMPLETE {
                        return Err(format!("buffer {name} could not be drawn into"));
                    }
                    // start from zero, which a new texture does not promise
                    gl.clear_color(0.0, 0.0, 0.0, 0.0);
                    gl.clear(glow::COLOR_BUFFER_BIT);
                    textures.push(t);
                    fbos.push(f);
                }
                buffers.push(Buffer { name: name.clone(), width: *bw, height: *bh, textures: [textures[0], textures[1]], framebuffers: [fbos[0], fbos[1]], read: 0 });
            }
            let framebuffer = gl.create_framebuffer()?;
            let renderbuffer = gl.create_renderbuffer()?;
            gl.bind_renderbuffer(glow::RENDERBUFFER, Some(renderbuffer));
            gl.renderbuffer_storage(glow::RENDERBUFFER, glow::RGBA8, width as i32, height as i32);
            gl.bind_framebuffer(glow::FRAMEBUFFER, Some(framebuffer));
            gl.framebuffer_renderbuffer(glow::FRAMEBUFFER, glow::COLOR_ATTACHMENT0, glow::RENDERBUFFER, Some(renderbuffer));
            if gl.check_framebuffer_status(glow::FRAMEBUFFER) != glow::FRAMEBUFFER_COMPLETE {
                return Err("offscreen framebuffer incomplete".into());
            }
            let vao = gl.create_vertex_array()?;
            Ok(ShaderRenderer {
                egl, display, context, surface: Some(surface), gl, program, framebuffer, renderbuffer, vao,
                width, height, frame: 0, last_time: 0.0, inputs, defaults, passes, buffers, pictures,
            })
        }
    }

    /// The name of the shader's place input, if it has one.
    pub fn place_input(&self) -> Option<&str> {
        self.inputs.iter().find(|i| i.kind == InputKind::Place).map(|i| i.name.as_str())
    }

    /// Draw the frame for `time` seconds since the animation started, with
    /// the given parameter values (missing ones take their ISF default), the
    /// state of the deck's controls and the world outside.
    pub fn render(&mut self, time: f32, params: &serde_json::Map<String, serde_json::Value>, interaction: &Interaction, world: &World) -> RgbImage {
        let (w, h) = (self.width, self.height);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        unsafe {
            let gl = &self.gl;
            gl.viewport(0, 0, w as i32, h as i32);
            gl.use_program(Some(self.program));
            let u = |name: &str| gl.get_uniform_location(self.program, name);
            gl.uniform_3_f32(u("iResolution").as_ref(), w as f32, h as f32, 1.0);
            gl.uniform_1_f32(u("iTime").as_ref(), time);
            gl.uniform_1_f32(u("iTimeDelta").as_ref(), (time - self.last_time).max(0.0));
            gl.uniform_1_i32(u("iFrame").as_ref(), self.frame);
            let m = interaction.mouse;
            gl.uniform_4_f32(u("iMouse").as_ref(), m[0], m[1], m[2], m[3]);
            let d = world.date;
            gl.uniform_4_f32(u("iDate").as_ref(), d[0], d[1], d[2], d[3]);
            gl.uniform_1_f32(u("iTimezone").as_ref(), world.timezone);
            let (p, wx) = (world.place, world.weather);
            gl.uniform_4_f32(u("iPlace").as_ref(), p[0], p[1], p[2], p[3]);
            gl.uniform_4_f32(u("iWeather").as_ref(), wx[0], wx[1], wx[2], wx[3]);
            let mut presses = [0.0f32; 32];
            for i in 0..8 {
                let (x, y, age, key) = interaction.presses.get(i).copied().unwrap_or((0.0, 0.0, 1e6, -1.0));
                presses[i * 4..i * 4 + 4].copy_from_slice(&[x, y, age, key]);
            }
            gl.uniform_4_f32_slice(u("iKeyPresses").as_ref(), &presses);
            gl.uniform_3_f32(u("iDials").as_ref(), 0.0, 0.0, 0.0);
            gl.uniform_1_f32_slice(u("iAudioBands").as_ref(), &interaction.audio_bands);
            gl.uniform_1_f32(u("iAudioLevel").as_ref(), interaction.audio_level);
            for input in &self.inputs {
                let value = params.get(&input.name).or_else(|| self.defaults.get(&input.name));
                let n = |i: usize| value.and_then(|v| v.get(i)).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
                let loc = u(&input.name);
                match input.kind {
                    InputKind::Float => gl.uniform_1_f32(loc.as_ref(), value.and_then(|v| v.as_f64()).unwrap_or(0.0) as f32),
                    InputKind::Long => gl.uniform_1_i32(loc.as_ref(), value.and_then(|v| v.as_i64()).unwrap_or(0) as i32),
                    InputKind::Bool => gl.uniform_1_i32(loc.as_ref(), value.and_then(|v| v.as_bool()).unwrap_or(false) as i32),
                    InputKind::Color => {
                        let a = value.and_then(|v| v.get(3)).and_then(|x| x.as_f64()).unwrap_or(1.0) as f32;
                        gl.uniform_4_f32(loc.as_ref(), n(0), n(1), n(2), a)
                    }
                    InputKind::Point2D => gl.uniform_2_f32(loc.as_ref(), n(0), n(1)),
                    InputKind::Place => {}
                }
            }
            gl.bind_vertex_array(Some(self.vao));
            for (index, pass) in self.passes.iter().enumerate() {
                gl.uniform_1_i32(u("PASSINDEX").as_ref(), index as i32);
                // every buffer readable at its latest contents
                for (unit, b) in self.buffers.iter().enumerate() {
                    gl.active_texture(glow::TEXTURE0 + unit as u32);
                    gl.bind_texture(glow::TEXTURE_2D, Some(b.textures[b.read]));
                    gl.uniform_1_i32(u(&b.name).as_ref(), unit as i32);
                }
                // and the pictures on the units after them
                for (i, (name, t)) in self.pictures.iter().enumerate() {
                    let unit = self.buffers.len() + i;
                    gl.active_texture(glow::TEXTURE0 + unit as u32);
                    gl.bind_texture(glow::TEXTURE_2D, Some(*t));
                    gl.uniform_1_i32(u(name).as_ref(), unit as i32);
                }
                let written = pass.target.as_ref().and_then(|t| self.buffers.iter().position(|b| &b.name == t));
                let (pw, ph) = match written {
                    Some(i) => {
                        let b = &self.buffers[i];
                        gl.bind_framebuffer(glow::FRAMEBUFFER, Some(b.framebuffers[1 - b.read]));
                        (b.width, b.height)
                    }
                    None => {
                        gl.bind_framebuffer(glow::FRAMEBUFFER, Some(self.framebuffer));
                        (w, h)
                    }
                };
                gl.viewport(0, 0, pw as i32, ph as i32);
                gl.uniform_2_f32(u("RENDERSIZE").as_ref(), pw as f32, ph as f32);
                gl.draw_arrays(glow::TRIANGLES, 0, 3);
                if let Some(i) = written {
                    self.buffers[i].read = 1 - self.buffers[i].read;
                }
            }
            gl.bind_framebuffer(glow::FRAMEBUFFER, Some(self.framebuffer));
            gl.read_pixels(0, 0, w as i32, h as i32, glow::RGBA, glow::UNSIGNED_BYTE, glow::PixelPackData::Slice(Some(&mut rgba)));
        }
        self.frame += 1;
        self.last_time = time;
        // OpenGL rows run bottom to top
        let mut out = RgbImage::new(w, h);
        for y in 0..h {
            let row = &rgba[((h - 1 - y) * w * 4) as usize..((h - y) * w * 4) as usize];
            for x in 0..w {
                let i = (x * 4) as usize;
                out.put_pixel(x, y, image::Rgb([row[i], row[i + 1], row[i + 2]]));
            }
        }
        out
    }
}

impl Drop for ShaderRenderer {
    fn drop(&mut self) {
        unsafe {
            self.gl.delete_vertex_array(self.vao);
            for (_, t) in &self.pictures {
                self.gl.delete_texture(*t);
            }
            for b in &self.buffers {
                for i in 0..2 {
                    self.gl.delete_framebuffer(b.framebuffers[i]);
                    self.gl.delete_texture(b.textures[i]);
                }
            }
            self.gl.delete_renderbuffer(self.renderbuffer);
            self.gl.delete_framebuffer(self.framebuffer);
            self.gl.delete_program(self.program);
        }
        let _ = self.egl.make_current(self.display, None, None, None);
        if let Some(s) = self.surface.take() {
            let _ = self.egl.destroy_surface(self.display, s);
        }
        let _ = self.egl.destroy_context(self.display, self.context);
        let _ = self.egl.terminate(self.display);
    }
}

/// The default display works on Mesa and on NVIDIA; the device platform is
/// the fallback for drivers whose default display needs a window system.
fn open_display(egl: &Egl) -> Result<egl::Display, String> {
    if let Some(d) = unsafe { egl.get_display(egl::DEFAULT_DISPLAY) } {
        if egl.initialize(d).is_ok() {
            return Ok(d);
        }
    }
    const PLATFORM_DEVICE_EXT: egl::Enum = 0x313F;
    type QueryDevices = unsafe extern "system" fn(egl::Int, *mut *mut std::ffi::c_void, *mut egl::Int) -> egl::Boolean;
    type PlatformDisplay = unsafe extern "system" fn(egl::Enum, *mut std::ffi::c_void, *const egl::Attrib) -> egl::EGLDisplay;
    let query = egl.get_proc_address("eglQueryDevicesEXT").ok_or("no default EGL display and no eglQueryDevicesEXT")?;
    let platform = egl.get_proc_address("eglGetPlatformDisplay").ok_or("no eglGetPlatformDisplay")?;
    unsafe {
        let query: QueryDevices = std::mem::transmute(query);
        let platform: PlatformDisplay = std::mem::transmute(platform);
        let mut devices = [std::ptr::null_mut(); 8];
        let mut count = 0;
        if query(8, devices.as_mut_ptr(), &mut count) == 0 || count == 0 {
            return Err("no EGL devices".into());
        }
        let attrib = [egl::NONE as egl::Attrib];
        let d = platform(PLATFORM_DEVICE_EXT, devices[0], attrib.as_ptr());
        if d.is_null() {
            return Err("no EGL display on the first device".into());
        }
        Ok(egl::Display::from_ptr(d))
    }
}

unsafe fn compile(gl: &glow::Context, body: &str, inputs: &[Input], buffers: &[String], pictures: &[String]) -> Result<glow::Program, String> {
    unsafe {
        let program = gl.create_program()?;
        let mut shaders = vec![];
        let mut declarations: String = inputs.iter().filter_map(|i| Some(format!("uniform {} {};\n", i.kind.glsl()?, i.name))).collect();
        declarations.push_str("uniform int PASSINDEX;\nuniform vec2 RENDERSIZE;\n");
        declarations.push_str("#define IMG_NORM_PIXEL(image, uv) texture(image, uv)\n#define IMG_PIXEL(image, px) texture(image, (px) / iResolution.xy)\n");
        declarations.push_str("#define IMG_THIS_PIXEL(image) texture(image, gl_FragCoord.xy / RENDERSIZE)\n#define IMG_THIS_NORM_PIXEL(image) IMG_THIS_PIXEL(image)\n");
        declarations.push_str("#define IMG_SIZE(image) vec2(textureSize(image, 0))\n");
        for b in buffers.iter().chain(pictures) {
            declarations.push_str(&format!("uniform sampler2D {b};\n"));
        }
        for (kind, src) in [(glow::VERTEX_SHADER, VERTEX.to_string()), (glow::FRAGMENT_SHADER, format!("{PRELUDE}{declarations}{body}{EPILOGUE}"))] {
            let s = gl.create_shader(kind)?;
            gl.shader_source(s, &src);
            gl.compile_shader(s);
            if !gl.get_shader_compile_status(s) {
                return Err(format!("shader did not compile: {}", gl.get_shader_info_log(s)));
            }
            gl.attach_shader(program, s);
            shaders.push(s);
        }
        gl.link_program(program);
        if !gl.get_program_link_status(program) {
            return Err(format!("shader did not link: {}", gl.get_program_info_log(program)));
        }
        for s in shaders {
            gl.detach_shader(program, s);
            gl.delete_shader(s);
        }
        Ok(program)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_isf_passes() {
        let src = r#"/*{ "PASSES": [ { "TARGET": "flow", "PERSISTENT": true, "FLOAT": true }, { "TARGET": "smoke" }, {} ] }*/ x"#;
        assert_eq!(parse_passes(src), vec![
            Pass { target: Some("flow".into()), float: true, scale: (1.0, 1.0) },
            Pass { target: Some("smoke".into()), float: false, scale: (1.0, 1.0) },
            Pass { target: None, float: false, scale: (1.0, 1.0) },
        ]);
        assert_eq!(parse_passes("void mainImage(out vec4 c, in vec2 p) {}"), vec![Pass { target: None, float: false, scale: (1.0, 1.0) }]);
        let sized = parse_passes(r#"/*{ "PASSES": [ { "TARGET": "a", "WIDTH": "$WIDTH/4", "HEIGHT": "$HEIGHT * 0.5" } ] }*/"#);
        assert_eq!(sized[0].scale, (0.25, 0.5));
        // a header whose last pass draws a buffer still gets a pass to show
        assert_eq!(parse_passes(r#"/*{ "PASSES": [ { "TARGET": "a" } ] }*/"#).len(), 2);
    }

    #[test]
    fn reads_imported_pictures_and_places() {
        let src = r#"/*{ "IMPORTED": { "moon": { "PATH": "data:image/png;base64,AAAA" }, "bad name": { "PATH": "x" }, "nopath": {} },
            "INPUTS": [ { "NAME": "place", "TYPE": "place" } ] }*/ x"#;
        assert_eq!(parse_imported(src), vec![("moon".to_string(), "data:image/png;base64,AAAA".to_string())]);
        assert_eq!(parse_inputs(src).0, vec![Input { name: "place".into(), kind: InputKind::Place }]);
        assert!(parse_imported("void mainImage(out vec4 c, in vec2 p) {}").is_empty());
    }

    #[test]
    fn knows_the_local_date() {
        let (d, zone) = local_date();
        assert!(d[0] >= 2024.0 && (0.0..12.0).contains(&d[1]) && (1.0..32.0).contains(&d[2]) && (0.0..86_401.0).contains(&d[3]));
        assert!(zone.abs() <= 14.0 * 3600.0);
    }

    /// Draws on the graphics card: `cargo test --release -- --ignored`.
    #[test]
    #[ignore]
    fn draws_pictures_upright_and_the_world() {
        // a 1x2 picture, red on top and blue below, as a PNG inside the source
        let mut picture = image::RgbaImage::new(1, 2);
        picture.put_pixel(0, 0, image::Rgba([255, 0, 0, 255]));
        picture.put_pixel(0, 1, image::Rgba([0, 0, 255, 255]));
        let mut png = vec![];
        picture.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        use base64::Engine;
        let data = base64::engine::general_purpose::STANDARD.encode(&png);
        let src = format!(
            r#"/*{{ "IMPORTED": {{ "pic": {{ "PATH": "data:image/png;base64,{data}" }} }}, "INPUTS": [ {{ "NAME": "place", "TYPE": "place" }} ] }}*/
            void mainImage(out vec4 c, in vec2 p) {{
                vec2 uv = p / iResolution.xy;
                // the left half shows the picture; the right half the world, as tests
                if (uv.x < 0.5) c = texture(pic, vec2(0.5, uv.y));
                else c = vec4(iDate.x > 2023.0 ? 1.0 : 0.0, iWeather.x == 3.0 ? 1.0 : 0.0, iPlace.x == 27.5 && IMG_SIZE(pic).y == 2.0 ? 1.0 : 0.0, 1.0);
            }}"#
        );
        let mut r = ShaderRenderer::new(&src, 8, 8).unwrap();
        assert_eq!(r.place_input(), Some("place"));
        let report = crate::weather::Report { code: 3, wind: 10.0, sunrise: 0.0, sunset: 0.0, offset: 0 };
        let frame = r.render(0.0, &serde_json::Map::new(), &Interaction::default(), &World::now(Some((27.5, -82.0)), Some(report)));
        // the image's rows run top to bottom: red at the top, blue at the bottom
        assert_eq!(frame.get_pixel(1, 0).0, [255, 0, 0]);
        assert_eq!(frame.get_pixel(1, 7).0, [0, 0, 255]);
        assert_eq!(frame.get_pixel(6, 4).0, [255, 255, 255]);
    }

    #[test]
    fn reads_isf_inputs_and_defaults() {
        let src = r#"/*{ "DESCRIPTION": "x", "INPUTS": [
            { "NAME": "speed", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0, "MAX": 3 },
            { "NAME": "tint", "TYPE": "color", "DEFAULT": [1, 0.5, 0, 1] },
            { "NAME": "bad name", "TYPE": "float" },
            { "NAME": "img", "TYPE": "image" }
        ] }*/
        void mainImage(out vec4 c, in vec2 p) { c = vec4(0); }"#;
        let (inputs, defaults) = parse_inputs(src);
        assert_eq!(inputs, vec![
            Input { name: "speed".into(), kind: InputKind::Float },
            Input { name: "tint".into(), kind: InputKind::Color },
        ]);
        assert_eq!(defaults["speed"], serde_json::json!(1.5));
        assert!(parse_inputs("void mainImage(out vec4 c, in vec2 p) {}").0.is_empty());
    }
}
