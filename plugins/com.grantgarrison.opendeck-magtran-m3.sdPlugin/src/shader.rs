//! Native animated backgrounds: Shadertoy-format fragment shaders rendered
//! on the GPU with no window, through EGL and OpenGL ES 3.
//!
//! A shader is the body Shadertoy expects, defining
//! `void mainImage(out vec4 fragColor, in vec2 fragCoord)` and reading the
//! usual uniforms (`iResolution`, `iTime`, `iTimeDelta`, `iFrame`, `iDate`,
//! `iMouse`). Channels (`iChannel0`..) are not provided. Each frame is drawn
//! into an offscreen framebuffer at the panel's size and read back.
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
out vec4 ectodeckFragColor;
";

const EPILOGUE: &str = "
void main() {
    vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
    mainImage(color, gl_FragCoord.xy);
    ectodeckFragColor = vec4(color.rgb, 1.0);
}";

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

        unsafe {
            let program = compile(&gl, source)?;
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
                width, height, frame: 0, last_time: 0.0,
            })
        }
    }

    /// Draw the frame for `time` seconds since the animation started.
    pub fn render(&mut self, time: f32) -> RgbImage {
        let (w, h) = (self.width, self.height);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        unsafe {
            let gl = &self.gl;
            gl.bind_framebuffer(glow::FRAMEBUFFER, Some(self.framebuffer));
            gl.viewport(0, 0, w as i32, h as i32);
            gl.use_program(Some(self.program));
            let u = |name: &str| gl.get_uniform_location(self.program, name);
            gl.uniform_3_f32(u("iResolution").as_ref(), w as f32, h as f32, 1.0);
            gl.uniform_1_f32(u("iTime").as_ref(), time);
            gl.uniform_1_f32(u("iTimeDelta").as_ref(), (time - self.last_time).max(0.0));
            gl.uniform_1_i32(u("iFrame").as_ref(), self.frame);
            gl.uniform_4_f32(u("iMouse").as_ref(), 0.0, 0.0, 0.0, 0.0);
            gl.uniform_4_f32(u("iDate").as_ref(), 0.0, 0.0, 0.0, seconds_today());
            gl.bind_vertex_array(Some(self.vao));
            gl.draw_arrays(glow::TRIANGLES, 0, 3);
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

unsafe fn compile(gl: &glow::Context, body: &str) -> Result<glow::Program, String> {
    unsafe {
        let program = gl.create_program()?;
        let mut shaders = vec![];
        for (kind, src) in [(glow::VERTEX_SHADER, VERTEX.to_string()), (glow::FRAGMENT_SHADER, format!("{PRELUDE}{body}{EPILOGUE}"))] {
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

fn seconds_today() -> f32 {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    (now % 86_400) as f32
}
