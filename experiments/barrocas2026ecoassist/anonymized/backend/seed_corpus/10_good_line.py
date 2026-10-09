# A reasonably clean line chart
import matplotlib.pyplot as plt
import numpy as np
x = np.linspace(0, 2 * np.pi, 100)
fig, ax = plt.subplots(figsize=(6, 4))
ax.plot(x, np.sin(x), label="sin")
ax.plot(x, np.cos(x), label="cos")
ax.legend(loc="lower left")
ax.set_title("Trigonometric functions")
ax.set_xlabel("Angle (rad)")
ax.set_ylabel("Value")
fig.tight_layout()
