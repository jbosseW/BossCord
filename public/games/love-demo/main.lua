-- main.lua
-- Paddle Ball - A simple LOVE2D game for BossCord
-- This is a reference source file. It must be compiled with love.js to run in browser.
--
-- Controls: Move paddle with left/right arrow keys or A/D
-- Ball bounces off walls, paddle, and top. Miss the ball = lose a life.
-- Break all bricks to win. Score earns BossCord chips via bridge.

local PaddleBall = {}

-- Constants
local SCREEN_W = 800
local SCREEN_H = 600

local PADDLE_W = 120
local PADDLE_H = 14
local PADDLE_Y = SCREEN_H - 40
local PADDLE_SPEED = 500

local BALL_RADIUS = 8
local BALL_SPEED_INITIAL = 300
local BALL_SPEED_INCREMENT = 10

local BRICK_ROWS = 5
local BRICK_COLS = 10
local BRICK_W = 70
local BRICK_H = 20
local BRICK_PADDING = 4
local BRICK_OFFSET_X = 30
local BRICK_OFFSET_Y = 60

local MAX_LIVES = 3

-- Game state
local paddle = { x = 0, y = PADDLE_Y, w = PADDLE_W, h = PADDLE_H }
local ball = { x = 0, y = 0, vx = 0, vy = 0, radius = BALL_RADIUS, speed = BALL_SPEED_INITIAL }
local bricks = {}
local score = 0
local lives = MAX_LIVES
local gameState = "menu" -- "menu", "playing", "gameover", "win"

-- Brick colors by row (LOVE uses 0-1 color values)
local BRICK_COLORS = {
    { 0.93, 0.26, 0.27 }, -- red
    { 0.94, 0.70, 0.20 }, -- gold
    { 0.34, 0.95, 0.53 }, -- green
    { 0.20, 0.60, 0.95 }, -- blue
    { 0.61, 0.35, 0.71 }, -- purple
}

-- Font cache
local fontCache = {}
local function getFont(size)
    if not fontCache[size] then
        fontCache[size] = love.graphics.newFont(size)
    end
    return fontCache[size]
end

local function resetBall()
    ball.x = paddle.x + paddle.w / 2
    ball.y = paddle.y - ball.radius - 2
    -- Random angle between 30 and 150 degrees (upward)
    local angle = math.rad(math.random(220, 320))
    ball.vx = math.cos(angle) * ball.speed
    ball.vy = math.sin(angle) * ball.speed
end

local function initBricks()
    bricks = {}
    for row = 1, BRICK_ROWS do
        for col = 1, BRICK_COLS do
            local brick = {
                x = BRICK_OFFSET_X + (col - 1) * (BRICK_W + BRICK_PADDING),
                y = BRICK_OFFSET_Y + (row - 1) * (BRICK_H + BRICK_PADDING),
                w = BRICK_W,
                h = BRICK_H,
                alive = true,
                color = BRICK_COLORS[row] or { 1, 1, 1 },
                points = (BRICK_ROWS - row + 1) * 10,
            }
            bricks[#bricks + 1] = brick
        end
    end
end

local function startGame()
    score = 0
    lives = MAX_LIVES
    ball.speed = BALL_SPEED_INITIAL
    paddle.x = (SCREEN_W - PADDLE_W) / 2
    initBricks()
    resetBall()
    gameState = "playing"
end

local function checkBrickCollision()
    for i, brick in ipairs(bricks) do
        if brick.alive then
            -- AABB vs circle collision
            local closestX = math.max(brick.x, math.min(ball.x, brick.x + brick.w))
            local closestY = math.max(brick.y, math.min(ball.y, brick.y + brick.h))
            local dx = ball.x - closestX
            local dy = ball.y - closestY
            local distSq = dx * dx + dy * dy

            if distSq < ball.radius * ball.radius then
                brick.alive = false
                score = score + brick.points

                -- Determine which side was hit for reflection
                local overlapX = (brick.w / 2 + ball.radius) - math.abs(ball.x - (brick.x + brick.w / 2))
                local overlapY = (brick.h / 2 + ball.radius) - math.abs(ball.y - (brick.y + brick.h / 2))

                if overlapX < overlapY then
                    ball.vx = -ball.vx
                else
                    ball.vy = -ball.vy
                end

                -- Speed up slightly
                ball.speed = math.min(ball.speed + BALL_SPEED_INCREMENT, 600)

                return true
            end
        end
    end
    return false
end

local function allBricksDestroyed()
    for _, brick in ipairs(bricks) do
        if brick.alive then return false end
    end
    return true
end

function love.load()
    love.window.setTitle("Paddle Ball - BossCord")
    love.graphics.setBackgroundColor(0.06, 0.06, 0.12)
    startGame()
    gameState = "menu"
end

function love.update(dt)
    if gameState ~= "playing" then return end

    -- Clamp dt to prevent tunneling on lag spikes
    if dt > 0.05 then dt = 0.05 end

    -- Paddle movement
    if love.keyboard.isDown("left") or love.keyboard.isDown("a") then
        paddle.x = paddle.x - PADDLE_SPEED * dt
    end
    if love.keyboard.isDown("right") or love.keyboard.isDown("d") then
        paddle.x = paddle.x + PADDLE_SPEED * dt
    end
    paddle.x = math.max(0, math.min(SCREEN_W - paddle.w, paddle.x))

    -- Ball movement
    ball.x = ball.x + ball.vx * dt
    ball.y = ball.y + ball.vy * dt

    -- Wall bounces (left/right)
    if ball.x - ball.radius < 0 then
        ball.x = ball.radius
        ball.vx = math.abs(ball.vx)
    elseif ball.x + ball.radius > SCREEN_W then
        ball.x = SCREEN_W - ball.radius
        ball.vx = -math.abs(ball.vx)
    end

    -- Top wall bounce
    if ball.y - ball.radius < 0 then
        ball.y = ball.radius
        ball.vy = math.abs(ball.vy)
    end

    -- Bottom: lose life
    if ball.y + ball.radius > SCREEN_H then
        lives = lives - 1
        if lives <= 0 then
            gameState = "gameover"
        else
            resetBall()
        end
        return
    end

    -- Paddle collision
    if ball.vy > 0 then
        if ball.y + ball.radius >= paddle.y and
           ball.y + ball.radius <= paddle.y + paddle.h + ball.speed * dt and
           ball.x >= paddle.x and ball.x <= paddle.x + paddle.w then
            ball.y = paddle.y - ball.radius
            -- Angle based on where ball hits paddle
            local hitPos = (ball.x - paddle.x) / paddle.w -- 0 to 1
            local angle = math.rad(150 - hitPos * 120) -- 150 to 30 degrees
            local spd = math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
            ball.vx = math.cos(angle) * spd
            ball.vy = -math.abs(math.sin(angle) * spd)
        end
    end

    -- Brick collisions
    checkBrickCollision()

    -- Win check
    if allBricksDestroyed() then
        gameState = "win"
    end
end

function love.draw()
    -- Draw bricks
    for _, brick in ipairs(bricks) do
        if brick.alive then
            love.graphics.setColor(brick.color[1], brick.color[2], brick.color[3])
            love.graphics.rectangle("fill", brick.x, brick.y, brick.w, brick.h, 3, 3)
            -- Highlight
            love.graphics.setColor(1, 1, 1, 0.15)
            love.graphics.rectangle("fill", brick.x, brick.y, brick.w, brick.h / 3, 3, 3)
        end
    end

    -- Draw paddle
    love.graphics.setColor(0.94, 0.70, 0.20) -- #f0b232
    love.graphics.rectangle("fill", paddle.x, paddle.y, paddle.w, paddle.h, 4, 4)
    love.graphics.setColor(1, 1, 1, 0.3)
    love.graphics.rectangle("fill", paddle.x + 2, paddle.y + 1, paddle.w - 4, paddle.h / 3, 3, 3)

    -- Draw ball
    love.graphics.setColor(1, 1, 1)
    love.graphics.circle("fill", ball.x, ball.y, ball.radius)
    love.graphics.setColor(1, 1, 1, 0.4)
    love.graphics.circle("fill", ball.x - 2, ball.y - 2, ball.radius * 0.4)

    -- HUD
    love.graphics.setColor(0.94, 0.70, 0.20)
    love.graphics.setFont(getFont(18))
    love.graphics.print("Score: " .. score, 16, 10)

    love.graphics.setColor(1, 1, 1)
    love.graphics.printf("Lives: " .. lives, 0, 10, SCREEN_W - 16, "right")

    -- Overlays
    if gameState == "menu" then
        love.graphics.setColor(0, 0, 0, 0.7)
        love.graphics.rectangle("fill", 0, 0, SCREEN_W, SCREEN_H)
        love.graphics.setColor(0.94, 0.70, 0.20)
        love.graphics.setFont(getFont(36))
        love.graphics.printf("Paddle Ball", 0, SCREEN_H / 2 - 60, SCREEN_W, "center")
        love.graphics.setColor(0.58, 0.61, 0.64)
        love.graphics.setFont(getFont(16))
        love.graphics.printf("Arrow Keys or A/D to move", 0, SCREEN_H / 2 - 10, SCREEN_W, "center")
        love.graphics.printf("Press SPACE to start", 0, SCREEN_H / 2 + 20, SCREEN_W, "center")

    elseif gameState == "gameover" then
        love.graphics.setColor(0, 0, 0, 0.7)
        love.graphics.rectangle("fill", 0, 0, SCREEN_W, SCREEN_H)
        love.graphics.setColor(0.93, 0.26, 0.27)
        love.graphics.setFont(getFont(36))
        love.graphics.printf("Game Over", 0, SCREEN_H / 2 - 50, SCREEN_W, "center")
        love.graphics.setColor(0.34, 0.95, 0.53)
        love.graphics.setFont(getFont(22))
        love.graphics.printf("Score: " .. score, 0, SCREEN_H / 2, SCREEN_W, "center")
        love.graphics.setColor(0.58, 0.61, 0.64)
        love.graphics.setFont(getFont(16))
        love.graphics.printf("Press SPACE to restart", 0, SCREEN_H / 2 + 40, SCREEN_W, "center")

    elseif gameState == "win" then
        love.graphics.setColor(0, 0, 0, 0.7)
        love.graphics.rectangle("fill", 0, 0, SCREEN_W, SCREEN_H)
        love.graphics.setColor(0.34, 0.95, 0.53)
        love.graphics.setFont(getFont(36))
        love.graphics.printf("You Win!", 0, SCREEN_H / 2 - 50, SCREEN_W, "center")
        love.graphics.setColor(0.94, 0.70, 0.20)
        love.graphics.setFont(getFont(22))
        love.graphics.printf("Score: " .. score, 0, SCREEN_H / 2, SCREEN_W, "center")
        love.graphics.setColor(0.58, 0.61, 0.64)
        love.graphics.setFont(getFont(16))
        love.graphics.printf("Press SPACE to play again", 0, SCREEN_H / 2 + 40, SCREEN_W, "center")
    end
end

function love.keypressed(key)
    if key == "space" then
        if gameState == "menu" or gameState == "gameover" or gameState == "win" then
            startGame()
        end
    end
    if key == "escape" then
        -- In browser via love.js, this could trigger bridge close
        -- BossCordBridge.requestClose() called via JS interop
    end
end

return PaddleBall
