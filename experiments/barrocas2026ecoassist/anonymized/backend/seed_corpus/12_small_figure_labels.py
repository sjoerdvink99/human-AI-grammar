# Tiny figure with big title that gets cut off
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(3, 2))
ax.bar(["Q1", "Q2", "Q3", "Q4"], [12, 18, 9, 22])
ax.set_title("Quarterly net promoter score across all regions", fontsize=12)
ax.set_xlabel("Quarter of the fiscal year")
ax.set_ylabel("Net promoter score")
