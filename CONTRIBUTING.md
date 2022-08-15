# Quirks of GNOME Shell Extensions

GNOME Shell Extensions are directly loaded into the same JavaScript Realm as the
Shell itself, so they have access to the same global variables as the Shell.

Most notably, the `imports` object, which is an odd `Proxy`-like object that has
properties that correspond to files and folders in the `js` directory of the
GNOME Shell source code. For example:
- `imports.ui.main` => `gnome-shell/js/ui/main.js`
- `imports.misc.extensionUtils` => `gnome-shell/js/misc/extensionUtils.js`

GNOME Shell extensions also use this to import their own code. The difference is
that they have to call `imports.misc.extensionUtils.getCurrentExtension`
to get a reference to themselves and then access the `imports` property on the
returned reference, which acts like the global `imports` object, except that its
properties correspond to files and folders in the extensions folder.

<!--
TODO: Expand further here so that it is easy to continue maintaining this
extension after my contract is over.
-->

# Quirk (bug) of Node

The build scripts for this repo spawn a _shit_ ton of promises to do work in
parallel, and for whatever reason, this causes node to have fatal errors when
exceptions are raised in some promises. So, if you get a fatal exception, its
probably this.
