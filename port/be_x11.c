/* X11 frontend for bcrt.pas (BOSS has no tiles): one text window, Xft font.
 * Copied from Omega's port/be_x11.c. Cell = char | colour << 8 (16 PC
 * colours, 0 = light grey) | 0x10000 reverse.
 * Env: BOSS_XFT (font, default Menlo), BOSS_TEXT (px, 26), BOSS_POS "x,y". */
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/keysym.h>
#include <X11/Xft/Xft.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <stdio.h>
#define A_STANDOUT 0x10000
#include <time.h>

static Display *dpy;
static Window win;
static Pixmap pix;
static GC gc;
static XftDraw *xd;
static XftFont *fnt;
static XftColor col[16];
static int cols, rows, tw, th, cy, cx;

static const unsigned char pal[16][3] = {
    {0,0,0}, {0,0,170}, {0,170,0}, {0,170,170}, {170,0,0}, {170,0,170}, {170,85,0}, {170,170,170},
    {85,85,85}, {85,85,255}, {85,255,85}, {85,255,255}, {255,85,85}, {255,85,255}, {255,255,85}, {255,255,255}};

void be_init(int c, int r)
{
    XSizeHints h;
    XGlyphInfo gi;
    const char *e;
    int scr, i, x = 0, y = 0;
    Visual *vis;
    Colormap cm;

    if (!(dpy = XOpenDisplay(NULL))) { fprintf(stderr, "boss: no X display\n"); exit(1); }
    scr = DefaultScreen(dpy); vis = DefaultVisual(dpy, scr); cm = DefaultColormap(dpy, scr);
    fnt = XftFontOpen(dpy, scr, XFT_FAMILY, XftTypeString, (e = getenv("BOSS_XFT")) ? e : "Menlo",
                      XFT_PIXEL_SIZE, XftTypeDouble, (e = getenv("BOSS_TEXT")) ? atof(e) : 26.0, NULL);
    XftTextExtents8(dpy, fnt, (FcChar8 *)"M", 1, &gi);
    tw = gi.xOff; th = fnt->ascent + fnt->descent;
    for (i = 0; i < 16; i++) {
        XRenderColor rc = { pal[i][0] * 257, pal[i][1] * 257, pal[i][2] * 257, 0xffff };
        XftColorAllocValue(dpy, vis, cm, &rc, &col[i]);
    }
    cols = c; rows = r;
    if ((e = getenv("BOSS_POS"))) sscanf(e, "%d,%d", &x, &y);
    win = XCreateSimpleWindow(dpy, DefaultRootWindow(dpy), x, y, c * tw, r * th, 0, 0, 0);
    h.flags = PPosition | USPosition | PMinSize | PMaxSize;
    h.x = x; h.y = y;
    h.min_width = h.max_width = c * tw;
    h.min_height = h.max_height = r * th;
    XSetWMNormalHints(dpy, win, &h);
    XStoreName(dpy, win, "BOSS: Beyond Moria");
    XSelectInput(dpy, win, KeyPressMask | ExposureMask);
    pix = XCreatePixmap(dpy, win, c * tw, r * th, DefaultDepth(dpy, scr));
    xd = XftDrawCreate(dpy, pix, vis, cm);
    gc = XCreateGC(dpy, win, 0, NULL);
    XftDrawRect(xd, &col[0], 0, 0, c * tw, r * th);
    XMapWindow(dpy, win);
    XFlush(dpy);
}

void be_put(int y, int x, int ch)
{
    FcChar8 c = ch & 255;
    int fg = ch >> 8 & 15, bg = 0, t;
    if (!fg) fg = 7;                /* plain text: light grey */
    if (ch & A_STANDOUT) { t = fg; fg = bg; bg = t; }
    XftDrawRect(xd, &col[bg], x * tw, y * th, tw, th);
    if (c != ' ') XftDrawString8(xd, &col[fg], fnt, x * tw, y * th + fnt->ascent, &c, 1);
}

void be_cursor(int y, int x) { cy = y; cx = x; }

void be_flush(void)
{
    XCopyArea(dpy, pix, win, gc, 0, 0, cols * tw, rows * th, 0, 0);
    XSetForeground(dpy, gc, col[7].pixel);
    XFillRectangle(dpy, win, gc, cx * tw, cy * th + th - 2, tw, 2);
    XFlush(dpy);
}

static int keycode(XKeyEvent *ev)
{
    char buf[8];
    KeySym ks;
    int n = XLookupString(ev, buf, sizeof buf, &ks, NULL);
    switch (ks) {       
    /* arrows = keypad digits: BOSS moves with them */
    case XK_Left: case XK_KP_Left: return '4';
    case XK_Right: case XK_KP_Right: return '6';
    case XK_Up: case XK_KP_Up: return '8';
    case XK_Down: case XK_KP_Down: return '2';
    case XK_Home: case XK_KP_Home: return '7';
    case XK_Prior: case XK_KP_Prior: return '9';
    case XK_End: case XK_KP_End: return '1';
    case XK_Next: case XK_KP_Next: return '3';
    case XK_KP_Begin: return '5';
    case XK_KP_Enter: case XK_Return: return '\r';
    case XK_BackSpace: case XK_Delete: return '\b';
    case XK_Escape: return 27;
    case XK_KP_Add: return '+';
    case XK_KP_Subtract: return '-';
    case XK_KP_Multiply: return '*';
    case XK_KP_Divide: return '/';
    case XK_KP_Decimal: case XK_KP_Delete: return '.';
    case XK_KP_Insert: return '0';
    }
    if (ks >= XK_KP_0 && ks <= XK_KP_9) return '0' + (int)(ks - XK_KP_0);
    return n == 1 ? (unsigned char)buf[0] : -1;
}

int be_getkey(int wait, int atcmd)
{
    XEvent ev;
    for (;;) {
        if (!wait && !XPending(dpy)) return -1;
        XNextEvent(dpy, &ev);
        if (ev.type == Expose) be_flush();
        else if (ev.type == KeyPress) {
            int k = keycode(&ev.xkey);
            if (k >= 0) return k;
        }
    }
}

void be_sleep(int ms)
{
    struct timespec t = { ms / 1000, ms % 1000 * 1000000L };
    nanosleep(&t, NULL);
}
void be_end(void) { if (dpy) XCloseDisplay(dpy); dpy = NULL; }
