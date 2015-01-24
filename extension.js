// Copyright (C) 2011-2014 R M Yorston
// Licence: GPLv2+

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Pango = imports.gi.Pango;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const WindowManager = imports.ui.windowManager;
const WorkspaceSwitcherPopup = imports.ui.workspaceSwitcherPopup;

const Config = imports.misc.config;

const _f = imports.gettext.domain('frippery-bottom-panel').gettext;

const OVERRIDES_SCHEMA = 'org.gnome.shell.overrides';


let nrows = 1;

function get_ncols() {
    let ncols = Math.floor(global.screen.n_workspaces/nrows);
    if ( global.screen.n_workspaces%nrows != 0 )
       ++ncols

    return ncols;
}

const FRIPPERY_TIMEOUT = 400;

const FripperySwitcherPopup = new Lang.Class({
    Name: 'FripperySwitcherPopup',
    Extends:  WorkspaceSwitcherPopup.WorkspaceSwitcherPopup,

    _getPreferredHeight : function (actor, forWidth, alloc) {
        let children = this._list.get_children();
        let primary = Main.layoutManager.primaryMonitor;

        let availHeight = primary.height;
        availHeight -= Main.panel.actor.height;
        availHeight -= this.actor.get_theme_node().get_vertical_padding();
        availHeight -= this._container.get_theme_node().get_vertical_padding();
        availHeight -= this._list.get_theme_node().get_vertical_padding();

        let [childMinHeight, childNaturalHeight] = children[0].get_preferred_height(-1);

        let height = nrows * childNaturalHeight;

        let spacing = this._itemSpacing * (nrows - 1);
        height += spacing;
        height = Math.min(height, availHeight);

        this._childHeight = (height - spacing) / nrows;

        alloc.min_size = height;
        alloc.natural_size = height;
    },

    _getPreferredWidth : function (actor, forHeight, alloc) {
        let children = this._list.get_children();
        let primary = Main.layoutManager.primaryMonitor;

        let availWidth = primary.width;
        availWidth -= this.actor.get_theme_node().get_horizontal_padding();
        availWidth -= this._container.get_theme_node().get_horizontal_padding();
        availWidth -= this._list.get_theme_node().get_horizontal_padding();

        let ncols = get_ncols();

        let [childMinHeight, childNaturalHeight] = children[0].get_preferred_height(-1);
        let childNaturalWidth = childNaturalHeight * primary.width/primary.height;

        let width = ncols * childNaturalWidth;

        let spacing = this._itemSpacing * (ncols - 1);
        width += spacing;
        width = Math.min(width, availWidth);

        this._childWidth = (width - spacing) / ncols;

        alloc.min_size = width;
        alloc.natural_size = width;
    },

    _allocate : function (actor, box, flags) {
        let children = this._list.get_children();
        let childBox = new Clutter.ActorBox();

        let ncols = get_ncols();

        for ( let ir=0; ir<nrows; ++ir ) {
            for ( let ic=0; ic<ncols; ++ic ) {
                let i = ncols*ir + ic;
                let x = box.x1 + ic * (this._childWidth + this._itemSpacing);
                childBox.x1 = x;
                childBox.x2 = x + this._childWidth;
                let y = box.y1 + ir * (this._childHeight + this._itemSpacing);
                childBox.y1 = y;
                childBox.y2 = y + this._childHeight;
                children[i].allocate(childBox, flags);
            }
        }
    },

    _redraw : function(direction, activeWorkspaceIndex) {
        this._list.destroy_all_children();

        for (let i = 0; i < global.screen.n_workspaces; i++) {
            let indicator = null;

           if (i == activeWorkspaceIndex && direction == Meta.MotionDirection.LEFT)
               indicator = new St.Bin({ style_class: 'ws-switcher-active-left' });
           else if (i == activeWorkspaceIndex && direction == Meta.MotionDirection.RIGHT)
               indicator = new St.Bin({ style_class: 'ws-switcher-active-right' });
           else if (i == activeWorkspaceIndex && direction == Meta.MotionDirection.UP)
               indicator = new St.Bin({ style_class: 'ws-switcher-active-up' });
           else if (i == activeWorkspaceIndex && direction == Meta.MotionDirection.DOWN)
               indicator = new St.Bin({ style_class: 'ws-switcher-active-down' });
           else
               indicator = new St.Bin({ style_class: 'ws-switcher-box' });

           this._list.add_actor(indicator);

        }
    },

    display : function(direction, activeWorkspaceIndex) {
        this._redraw(direction, activeWorkspaceIndex);
        if (this._timeoutId != 0)
            Mainloop.source_remove(this._timeoutId);
        this._timeoutId = Mainloop.timeout_add(FRIPPERY_TIMEOUT, Lang.bind(this, this._onTimeout));
        this._show();
    }
});

let myShowWorkspaceSwitcher, origShowWorkspaceSwitcher;

function init(extensionMeta) {
    
    origShowWorkspaceSwitcher =
        WindowManager.WindowManager.prototype._showWorkspaceSwitcher;

    myShowWorkspaceSwitcher = function(display, screen, window, binding) {
        if (!Main.sessionMode.hasWorkspaces)
            return;

        if (screen.n_workspaces == 1)
            return;
            
		// looks add first word of window manager action to get switch or move into 'action'
		// and target workspace number or up, down, right or left into 'target'
        let [action,,,target] = binding.get_name().split('-');
        let newWs;
        let direction;

        if (isNaN(target)) {
            direction = Meta.MotionDirection[target.toUpperCase()];
            newWs = screen.get_active_workspace().get_neighbor(direction);
        } else if (target > 0) {
            target--;
            newWs = screen.get_workspace_by_index(target);

            if (screen.get_active_workspace().index() > target)
                direction = Meta.MotionDirection.UP;
            else
                direction = Meta.MotionDirection.DOWN;
        }

        if (action == 'switch')
            this.actionMoveWorkspace(newWs);
        else
            this.actionMoveWindow(window, newWs);

        if (!Main.overview.visible) {
            if (this._workspaceSwitcherPopup == null) {
                this._workspaceSwitcherPopup = new FripperySwitcherPopup();
                this._workspaceSwitcherPopup.connect('destroy',
                    Lang.bind(this, function() {
                        this._workspaceSwitcherPopup = null;
                    }));
            }
            this._workspaceSwitcherPopup.display(direction, newWs.index());
        }
    };

    WindowManager.WindowManager.prototype._reset = function() {
        Meta.keybindings_set_custom_handler('switch-to-workspace-left',
                    Lang.bind(this, this._showWorkspaceSwitcher));
        Meta.keybindings_set_custom_handler('switch-to-workspace-right',
                    Lang.bind(this, this._showWorkspaceSwitcher));
        Meta.keybindings_set_custom_handler('switch-to-workspace-up',
                    Lang.bind(this, this._showWorkspaceSwitcher));
        Meta.keybindings_set_custom_handler('switch-to-workspace-down',
                    Lang.bind(this, this._showWorkspaceSwitcher));
        Meta.keybindings_set_custom_handler('move-to-workspace-left',
                    Lang.bind(this, this._showWorkspaceSwitcher));
        Meta.keybindings_set_custom_handler('move-to-workspace-right',
                    Lang.bind(this, this._showWorkspaceSwitcher));
        Meta.keybindings_set_custom_handler('move-to-workspace-up',
                    Lang.bind(this, this._showWorkspaceSwitcher));
        Meta.keybindings_set_custom_handler('move-to-workspace-down',
                    Lang.bind(this, this._showWorkspaceSwitcher));

        this._workspaceSwitcherPopup = null;
    };
}

function enable() {
    if ( Main.sessionMode.currentMode == 'classic' ) {
        return;
    }
    
    global.screen.override_workspace_layout(Meta.ScreenCorner.TOPLEFT, false, nrows, get_ncols());

    WindowManager.WindowManager.prototype._showWorkspaceSwitcher =
        myShowWorkspaceSwitcher;

    Main.wm._reset();
}

function disable() {
    if ( Main.sessionMode.currentMode == 'classic' ) {
        return;
    }

    global.screen.override_workspace_layout(Meta.ScreenCorner.TOPLEFT, false, -1, 1);

    WindowManager.WindowManager.prototype._showWorkspaceSwitcher =
        origShowWorkspaceSwitcher;

    Main.wm._reset();
}
