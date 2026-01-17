
let draggedItem = null;
let initialIndex = null;
// // 为每个taskItem元素添加draggable属性
// document.querySelectorAll("#todoList .taskItem").forEach((item) => {
//     if (item.classList.contains("done")) {
//         return;
//     }
//     setElementCanDrop(item);
// });


// 事件处理程序定义
function handleDragStart(e) {




    if (!taskMode) return;
    Ele_todoList.classList.add("noHover");

    draging = true;
    draggedItem = e.target;
    // draggedItem.classList.add("moving");

    draggedItem.classList.add("draggingAni");

    initialIndex = Array.from(Ele_todoList.children).indexOf(draggedItem);

    // e.target.style.opacity = " ";
    e.target.style.backgroundColor = "#FBF7F299";
    e.dataTransfer.setData("text/plain", ""); // 添加这行代码

    // document.getElementById("activeTip").style.display = "block";
    document.getElementById("doneList").style.backgroundColor = "#00000002";
    document.getElementById("doneList").style.opacity = "0.1";



    const transparentImage = document.createElement('img');
    transparentImage.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    transparentImage.width = 1;
    transparentImage.height = 1;

    // Use the invisible image as the drag image
    e.dataTransfer.setDragImage(transparentImage, 0, 0);
    // 让事件继续冒泡


}

function handleDragEnd(e) {
    draging = false;

    Ele_todoList.classList.remove("noHover");
    // e.target.style.opacity = "";
    e.target.style.backgroundColor = "";




    // 移除所有添加的动画类
    document.querySelectorAll(".taskItem").forEach((item) => {
        item.classList.remove("moving");
    });
    draggedItem.classList.remove("draggingAni");

    // document.getElementById("activeTip").style.display = "none";
    document.getElementById("doneList").style.backgroundColor = "";
    document.getElementById("doneList").style.opacity = "";




    const newIndex = Array.from(Ele_todoList.children).indexOf(draggedItem);

    if (initialIndex != newIndex) {
        console.log(`Element moved from index ${initialIndex} to index ${newIndex}`);
        // 打印元素的taskId属性
        console.log(draggedItem.getAttribute("taskId"));
        todoManger_.move(draggedItem.getAttribute("taskId"), "current", newIndex);
    }
    draggedItem = null;



}


// 设置元素可拖放
function setElementCanDrop(element) {
    element.setAttribute("draggable", "true");
    element.addEventListener("dragstart", handleDragStart);
    element.addEventListener("dragend", handleDragEnd);
}

// 移除元素的拖放事件
function removeElementCanDrop(element) {
    element.removeAttribute("draggable");
    element.removeEventListener("dragstart", handleDragStart);
    element.removeEventListener("dragend", handleDragEnd);
}

// 处理拖拽事件
Ele_todoList.addEventListener("dragover", function (e) {
    e.preventDefault();
    // console.log("dragover", e);
    e.dataTransfer.dropEffect = 'move'; 
    scaleFloating(e);

    // 确保拖动的是taskItem元素
    if (!draggedItem || !draggedItem.classList.contains("taskItem")) {
        return;
    }
    // console.log("dragover", draggedItem);

    const targetItem = getTargetItem(e.clientY);
    if (targetItem && targetItem !== draggedItem) {
        const rect = targetItem.getBoundingClientRect();
        const middleY = (rect.bottom + rect.top) / 2;
        console.log(draggedItem.previousSibling == targetItem, draggedItem.nextSibling == targetItem)

        if (e.clientY < middleY+10 && draggedItem.previousSibling == targetItem) {
            Ele_todoList.insertBefore(draggedItem, targetItem);
            // 添加动画类
            targetItem.classList.add("movingBottom");
            // console.log(targetItem);

            // 监听动画结束事件，移除动画类
            targetItem.addEventListener(
                "animationend",
                function () {
                    targetItem.classList.remove("movingBottom");
                },
                { once: true }
            );

        } else if (e.clientY > middleY-10 && draggedItem.nextSibling == targetItem) {
            Ele_todoList.insertBefore(draggedItem, targetItem.nextSibling);
            // 添加动画类
            targetItem.classList.add("movingTop");
            // console.log(targetItem);

            // 监听动画结束事件，移除动画类
            targetItem.addEventListener(
                "animationend",
                function () {
                    targetItem.classList.remove("movingTop");
                },
                { once: true }
            );

        }

    }

});

// 获取目标taskItem元素
function getTargetItem(y) {
    const taskItems = document.querySelectorAll(".currentList .taskItem"); // 更新taskItems选择
    for (let i = 0; i < taskItems.length; i++) {
        const rect = taskItems[i].getBoundingClientRect();
        if (y >= rect.top + 5 && y <= rect.bottom - 5) {
            return taskItems[i];
        }
    }
    return null;
}
