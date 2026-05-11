const user = utools.getUser();
if (user === null) {
  // document.getElementById("user").innerHTML = `Hi~`;
} else {
  document.getElementById("user").innerHTML = `
  <img src="${user.avatar}" class="avatar">`

  {/* <div class="userName" id="userName">${user.nickname}</div>`; */ }
}

