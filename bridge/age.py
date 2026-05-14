import json
from datetime import datetime, timezone

def increment_age():
    # Read current age
    with open('age.json', 'r') as f:
        data = json.load(f)
    
    # Increment age
    old_age = data['age']
    data['age'] = old_age + 1
    data['last_updated'] = datetime.now(timezone.utc).isoformat()
    
    # Save updated data
    with open('age.json', 'w') as f:
        json.dump(data, f, indent=2)
    
    print(f"Age incremented from {old_age} to {data['age']}")
    return data['age']

if __name__ == '__main__':
    new_age = increment_age()
    print(f"Current age: {new_age}")
