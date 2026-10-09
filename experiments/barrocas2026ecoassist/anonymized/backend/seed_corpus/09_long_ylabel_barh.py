# Horizontal bars with long labels clipped at the left edge
import matplotlib.pyplot as plt
tasks = ["Requirements gathering and stakeholder interviews", "System architecture design",
         "Implementation of the data ingestion pipeline", "Testing and quality assurance",
         "Deployment to the production environment"]
weeks = [3, 2, 6, 4, 1]
fig, ax = plt.subplots(figsize=(5, 3))
ax.barh(tasks, weeks)
ax.set_title("Project plan")
ax.set_xlabel("Weeks")
