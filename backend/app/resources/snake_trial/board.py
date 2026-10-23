"""共同绘图工具：只接收输入和绘制数据，不实现游戏规则。"""
import pygame


class Board:
    def __init__(self, rows=10, cols=10, cell=40):
        pygame.display.init()
        pygame.font.init()
        self.rows, self.cols, self.cell = rows, cols, cell
        self.screen = pygame.display.set_mode((cols * cell, rows * cell + 50))
        pygame.display.set_caption('SFLS Snake')
        self.font = pygame.font.Font(None, 26)
        self.clock = pygame.time.Clock()

    def events(self):
        """返回按键、点击或关闭事件；游戏是否接受输入由你的代码决定。"""
        keys = {pygame.K_UP: 'UP', pygame.K_w: 'UP', pygame.K_DOWN: 'DOWN', pygame.K_s: 'DOWN',
                pygame.K_LEFT: 'LEFT', pygame.K_a: 'LEFT', pygame.K_RIGHT: 'RIGHT', pygame.K_d: 'RIGHT',
                pygame.K_SPACE: 'PAUSE', pygame.K_r: 'RESET'}
        result = []
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                result.append({'type': 'quit'})
            elif event.type == pygame.KEYDOWN and event.key in keys:
                result.append({'type': 'key', 'key': keys[event.key]})
            elif event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
                x, y = event.pos
                # 屏幕用 x/y，游戏统一用 行/列；棋盘外返回 None。
                position = [y // self.cell, x // self.cell] if 0 <= x < self.cols * self.cell and 0 <= y < self.rows * self.cell else None
                result.append({'type': 'click', 'position': position, 'pixel': [x, y]})
        return result

    def draw(self, snake, foods, obstacles=(), score=0, message=''):
        """只画你传入的位置；foods 即使只有一个食物，也传坐标列表。"""
        self.screen.fill('#10170f')
        for row in range(self.rows):
            for col in range(self.cols):
                pygame.draw.rect(self.screen, '#303c24', (col*self.cell, row*self.cell, self.cell, self.cell), 1)
        for cells, color in ((obstacles, '#77806a'), (foods, '#ee7646'), (snake, '#c5fa26')):
            for row, col in cells:
                pygame.draw.rect(self.screen, color, (col*self.cell+3, row*self.cell+3, self.cell-6, self.cell-6), border_radius=7)
        label = self.font.render(f'Score: {score}  {message}', True, '#f2f4dc')
        self.screen.blit(label, (8, self.rows*self.cell+14))
        pygame.display.flip()

    def wait(self, fps=30):
        """让出 CPU，返回本帧用时（毫秒）；不自动移动蛇。"""
        return self.clock.tick(fps)

    def close(self):
        pygame.quit()


if __name__ == '__main__':
    # 仅用于检查窗口和输入。这里没有贪吃蛇游戏逻辑。
    board = Board()
    running = True
    while running:
        for event in board.events():
            print(event)
            if event['type'] == 'quit':
                running = False
        if running:
            board.draw([[4, 6], [4, 5], [4, 4]], [[4, 7]], message='Display check only')
            board.wait()
    board.close()
