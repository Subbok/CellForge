/* Transparently rewrite hardcoded webkit2gtk-4.1 libexec paths so
 * libwebkit2gtk-4.1.so spawns the auxiliary processes bundled in the
 * AppImage instead of the Debian multiarch path baked in at compile time.
 *
 * WebKit's PKGLIBEXECDIR is a compile-time constant; on a build machine
 * running Ubuntu it's `/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/`, which
 * doesn't exist on e.g. Arch-based distros (where webkit2gtk-4.1 lives at
 * `/usr/lib/webkit2gtk-4.1/`). The WEBKIT_EXEC_PATH env var was removed
 * upstream, leaving no runtime override.
 *
 * Loaded via LD_PRELOAD from the AppRun. We hook the handful of libc calls
 * glib's g_spawn* may use to launch children and rewrite paths prefixed
 * with PKGLIBEXECDIR to `$APPDIR/<original path>`. Non-matching paths pass
 * through unchanged, so jupyter kernel launches aren't affected.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <limits.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

/* Distros disagree on PKGLIBEXECDIR: Debian/Ubuntu use
 * /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/, Arch uses /usr/lib/webkit2gtk-4.1/.
 * Whichever prefix was baked in at build time, the tail is always the same —
 * so we match on the suffix and normalise to the canonical AppDir layout
 * regardless of where the libwebkit came from. */
static int is_webkit_helper(const char *name) {
    return strcmp(name, "WebKitWebProcess") == 0
        || strcmp(name, "WebKitNetworkProcess") == 0
        || strcmp(name, "WebKitGPUProcess") == 0
        || strcmp(name, "MiniBrowser") == 0;
}

static const char *rewrite(const char *path, char *buf, size_t buf_size) {
    if (!path || path[0] != '/') return path;
    const char *appdir = getenv("APPDIR");
    if (!appdir || !*appdir) return path;
    static const char MARK[] = "/webkit2gtk-4.1/";
    const char *m = strstr(path, MARK);
    if (!m) return path;
    const char *basename = m + sizeof(MARK) - 1;
    if (!is_webkit_helper(basename)) return path;
    int n = snprintf(buf, buf_size,
                     "%s/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/%s",
                     appdir, basename);
    if (n < 0 || (size_t)n >= buf_size) return path;
    return buf;
}

int execve(const char *p, char *const a[], char *const e[]) {
    static int (*real)(const char *, char *const[], char *const[]) = NULL;
    if (!real) real = dlsym(RTLD_NEXT, "execve");
    char buf[PATH_MAX];
    return real(rewrite(p, buf, sizeof(buf)), a, e);
}

int execv(const char *p, char *const a[]) {
    static int (*real)(const char *, char *const[]) = NULL;
    if (!real) real = dlsym(RTLD_NEXT, "execv");
    char buf[PATH_MAX];
    return real(rewrite(p, buf, sizeof(buf)), a);
}

int posix_spawn(pid_t *pid, const char *p,
                const posix_spawn_file_actions_t *fa,
                const posix_spawnattr_t *attr,
                char *const argv[], char *const envp[]) {
    static int (*real)(pid_t *, const char *,
                       const posix_spawn_file_actions_t *,
                       const posix_spawnattr_t *,
                       char *const[], char *const[]) = NULL;
    if (!real) real = dlsym(RTLD_NEXT, "posix_spawn");
    char buf[PATH_MAX];
    return real(pid, rewrite(p, buf, sizeof(buf)), fa, attr, argv, envp);
}

int posix_spawnp(pid_t *pid, const char *p,
                 const posix_spawn_file_actions_t *fa,
                 const posix_spawnattr_t *attr,
                 char *const argv[], char *const envp[]) {
    static int (*real)(pid_t *, const char *,
                       const posix_spawn_file_actions_t *,
                       const posix_spawnattr_t *,
                       char *const[], char *const[]) = NULL;
    if (!real) real = dlsym(RTLD_NEXT, "posix_spawnp");
    char buf[PATH_MAX];
    return real(pid, rewrite(p, buf, sizeof(buf)), fa, attr, argv, envp);
}
