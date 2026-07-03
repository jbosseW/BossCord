-- conf.lua
-- LOVE2D configuration for Paddle Ball demo
-- This is a reference source file. It must be compiled with love.js to run in browser.

function love.conf(t)
    t.identity = "paddleball"
    t.version = "11.5"
    t.console = false

    t.window.title = "Paddle Ball - BossCord"
    t.window.width = 800
    t.window.height = 600
    t.window.resizable = false
    t.window.vsync = 1
    t.window.msaa = 0

    t.modules.audio = true
    t.modules.data = true
    t.modules.event = true
    t.modules.font = true
    t.modules.graphics = true
    t.modules.image = true
    t.modules.joystick = false
    t.modules.keyboard = true
    t.modules.math = true
    t.modules.mouse = true
    t.modules.physics = false
    t.modules.sound = true
    t.modules.system = true
    t.modules.thread = false
    t.modules.timer = true
    t.modules.touch = true
    t.modules.video = false
    t.modules.window = true
end
