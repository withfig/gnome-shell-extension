/*
 * Fig GNOME Shell Extension
 * Copyright (C) 2022 Hercules Labs
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/// <reference path="../types/index.d.ts"/>

const { Gio, GLib, GObject, Gtk } = imports.gi;

const Adw = (() => {
  try {
    return imports.gi.Adw;
  } catch (_) {
    return null;
  }
})();

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

var PreferencesWindow;

/* if (Adw != null) {
  PreferencesWindow = GObject.registerClass({
    GTypeName: "FigPreferencesWindow",
  }, class PreferencesWindow extends Adw.Bin {
    _init() {
      super._init();
    }
  });
} else { */
PreferencesWindow = GObject.registerClass(
  {
    GTypeName: "FigPreferencesWindow",
    Template:
      "resource:///org/gnome/shell/extensions/fig-gnome-integration/ui/gtk/Preferences.ui",
    InternalChildren: ["show_panel_icon", "other_preferences"],
  },
  class PreferencesWindow extends Gtk.Box {
    /** @private @property @type {import("../types/.gtk").Switch} */
    _show_panel_icon;
    /** @private @property @type {import("../types/.gtk").Button} */
    _other_preferences;

    _init() {
      super._init();

      //this._show_panel_icon.state = ExtensionUtils.getSettings().get_boolean("show-panel-icon");
      //
      //this._show_panel_icon.connect("state-set", () => {
      //  ExtensionUtils.getSettings().set_boolean("show-panel-icon", this._show_panel_icon.state);
      //});
      //
      //this._other_preferences.connect("clicked", () => {
      //  // TODO
      //});
    }
  }
);
//}

function buildPrefsWidget() {
  return new PreferencesWindow();
}
